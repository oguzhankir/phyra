//! Bounded byte framing independent of network chunk boundaries. Only displayed
//! text is emitted; reasoning and tool deltas are neither requested nor exposed.
use super::types::{Provider, Usage, MAX_RESPONSE};
use serde_json::Value;
const MAX_FRAME: usize = 128 * 1024;
const MAX_WIRE: usize = 4 * 1024 * 1024;
const MAX_FRAMES: usize = 16_384;
#[derive(Default)]
pub struct Decoder {
    pending: Vec<u8>,
    data: String,
    event: String,
    wire: usize,
    frames: usize,
}
pub struct Frame {
    pub event: String,
    pub data: String,
}
impl Decoder {
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<Frame>, String> {
        self.wire = self.wire.saturating_add(chunk.len());
        if self.wire > MAX_WIRE {
            return Err("Provider stream exceeds its byte limit".into());
        }
        self.pending.extend_from_slice(chunk);
        let mut frames = Vec::new();
        while let Some(index) = self.pending.iter().position(|b| *b == b'\n') {
            if index > MAX_FRAME {
                return Err("Provider stream frame is too large".into());
            }
            let line: Vec<u8> = self.pending.drain(..=index).collect();
            let line = std::str::from_utf8(&line[..line.len() - 1])
                .map_err(|_| "Provider stream is not valid UTF-8")?
                .trim_end_matches('\r');
            if line.is_empty() {
                if !self.data.is_empty() {
                    self.frames += 1;
                    if self.frames > MAX_FRAMES {
                        return Err("Provider stream has too many frames".into());
                    }
                    frames.push(Frame {
                        event: std::mem::take(&mut self.event),
                        data: std::mem::take(&mut self.data).trim_end_matches('\n').into(),
                    });
                }
                self.event.clear();
            } else if let Some(value) = line.strip_prefix("data:") {
                self.data.push_str(value.strip_prefix(' ').unwrap_or(value));
                self.data.push('\n');
            } else if let Some(value) = line.strip_prefix("event:") {
                self.event = value.trim().into();
            }
            if self.data.len() + self.event.len() > MAX_FRAME {
                return Err("Provider stream frame is too large".into());
            }
        }
        if self.pending.len() > MAX_FRAME {
            return Err("Provider stream frame is too large".into());
        }
        Ok(frames)
    }
    pub fn finish(&self) -> Result<(), String> {
        if self.pending.iter().all(u8::is_ascii_whitespace) && self.data.is_empty() {
            Ok(())
        } else {
            Err("Provider stream ended with an incomplete frame".into())
        }
    }
}
#[derive(Default)]
pub struct Delta {
    pub text: String,
    pub usage: Option<Usage>,
    pub done: bool,
}
fn tokens(value: &Value, key: &str) -> Option<u64> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .filter(|n| *n <= 9_007_199_254_740_991)
}
fn usage(value: &Value, input: &str, output: &str, total: &str) -> Usage {
    Usage {
        input_tokens: tokens(value, input),
        output_tokens: tokens(value, output),
        total_tokens: tokens(value, total),
    }
}
// Provider protocol references:
// https://ai.google.dev/api/generate-content#method:-models.streamgeneratecontent
// https://developers.openai.com/api/docs/guides/streaming-responses
// https://platform.claude.com/docs/en/build-with-claude/streaming
// https://docs.ollama.com/api/openai-compatibility
pub fn decode(provider: Provider, frame: Frame) -> Result<Delta, String> {
    if frame.data == "[DONE]" && matches!(provider, Provider::Compatible | Provider::Ollama) {
        return Ok(Delta {
            done: true,
            ..Delta::default()
        });
    }
    let value: Value = serde_json::from_str(&frame.data)
        .map_err(|_| "Provider returned a malformed stream event")?;
    if !value.is_object() {
        return Err("Provider stream event is not an object".into());
    }
    let kind = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or(&frame.event);
    if value.get("error").is_some()
        || matches!(kind, "error" | "response.failed" | "response.incomplete")
    {
        return Err(
            "Provider generation failed; check the model, permissions and provider limits".into(),
        );
    }
    let mut delta = Delta::default();
    match provider {
        Provider::Gemini => {
            if value
                .get("promptFeedback")
                .and_then(|v| v.get("blockReason"))
                .is_some()
            {
                return Err("Provider blocked this request".into());
            }
            if let Some(candidate) = value
                .get("candidates")
                .and_then(Value::as_array)
                .and_then(|v| v.first())
            {
                if let Some(parts) = candidate
                    .pointer("/content/parts")
                    .and_then(Value::as_array)
                {
                    for part in parts {
                        if part.get("functionCall").is_some() {
                            return Err("Assistant tool calls are not enabled".into());
                        }
                        if part.get("thought").and_then(Value::as_bool) != Some(true) {
                            if let Some(text) = part.get("text").and_then(Value::as_str) {
                                delta.text.push_str(text);
                            }
                        }
                    }
                }
                if let Some(reason) = candidate.get("finishReason").and_then(Value::as_str) {
                    if !matches!(reason, "STOP" | "MAX_TOKENS") {
                        return Err("Provider could not finish this text response".into());
                    }
                    delta.done = true;
                }
            }
            delta.usage = value.get("usageMetadata").map(|v| {
                usage(
                    v,
                    "promptTokenCount",
                    "candidatesTokenCount",
                    "totalTokenCount",
                )
            });
        }
        Provider::Openai => match kind {
            "response.output_text.delta" | "response.refusal.delta" => {
                delta.text = value
                    .get("delta")
                    .and_then(Value::as_str)
                    .ok_or("Provider text delta is malformed")?
                    .into()
            }
            "response.output_item.added" => {
                if value
                    .pointer("/item/type")
                    .and_then(Value::as_str)
                    .is_some_and(|s| !matches!(s, "message" | "reasoning"))
                {
                    return Err("Assistant tool calls are not enabled".into());
                }
            }
            "response.completed" => {
                delta.done = true;
                delta.usage = value
                    .pointer("/response/usage")
                    .map(|v| usage(v, "input_tokens", "output_tokens", "total_tokens"));
            }
            _ => {}
        },
        Provider::Anthropic => match kind {
            "message_start" => {
                delta.usage = value
                    .pointer("/message/usage")
                    .map(|v| usage(v, "input_tokens", "output_tokens", "total_tokens"))
            }
            "content_block_start" => {
                if value
                    .pointer("/content_block/type")
                    .and_then(Value::as_str)
                    .is_some_and(|s| !matches!(s, "text" | "thinking" | "redacted_thinking"))
                {
                    return Err("Assistant tool calls are not enabled".into());
                }
                if let Some(t) = value.pointer("/content_block/text").and_then(Value::as_str) {
                    delta.text = t.into();
                }
            }
            "content_block_delta" => {
                if value.pointer("/delta/type").and_then(Value::as_str) == Some("text_delta") {
                    delta.text = value
                        .pointer("/delta/text")
                        .and_then(Value::as_str)
                        .ok_or("Provider text delta is malformed")?
                        .into();
                }
            }
            "message_delta" => {
                delta.usage = value
                    .get("usage")
                    .map(|v| usage(v, "input_tokens", "output_tokens", "total_tokens"))
            }
            "message_stop" => delta.done = true,
            _ => {}
        },
        Provider::Compatible | Provider::Ollama => {
            if let Some(choices) = value.get("choices").and_then(Value::as_array) {
                if let Some(choice) = choices.first() {
                    if choice.pointer("/delta/tool_calls").is_some() {
                        return Err("Assistant tool calls are not enabled".into());
                    }
                    delta.text = choice
                        .pointer("/delta/content")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .into();
                    if choice
                        .get("finish_reason")
                        .and_then(Value::as_str)
                        .is_some_and(|s| !matches!(s, "stop" | "length"))
                    {
                        return Err("Provider did not complete a text response".into());
                    }
                }
            } else {
                return Err("Provider chat stream is malformed".into());
            }
            delta.usage = value
                .get("usage")
                .filter(|v| v.is_object())
                .map(|v| usage(v, "prompt_tokens", "completion_tokens", "total_tokens"));
        }
    }
    if delta.text.len() > MAX_RESPONSE {
        return Err("Provider text delta exceeds its limit".into());
    }
    Ok(delta)
}
pub fn merge_usage(current: &mut Usage, next: Usage) {
    let explicit_total = next.total_tokens;
    if next.input_tokens.is_some() {
        current.input_tokens = next.input_tokens;
    }
    if next.output_tokens.is_some() {
        current.output_tokens = next.output_tokens;
    }
    if next.total_tokens.is_some() {
        current.total_tokens = next.total_tokens;
    }
    if explicit_total.is_none() {
        if let (Some(a), Some(b)) = (current.input_tokens, current.output_tokens) {
            current.total_tokens = a.checked_add(b);
        }
    }
}
// Hold exact-key suffixes and unfinished credential-like tokens. Generic checks
// must see entire sk-/AIza/AQ. tokens before any text crosses native IPC.
fn credential_prefix_start(text: &str) -> Option<usize> {
    let token_byte = |byte: u8| byte.is_ascii_alphanumeric() || b"-_".contains(&byte);
    let start = text
        .bytes()
        .rposition(|byte| !token_byte(byte))
        .map_or(0, |index| index + 1);
    let tail = &text[start..];
    if !tail.is_empty()
        && ["sk-", "AIza", "AQ."]
            .iter()
            .any(|prefix| prefix.starts_with(tail) || tail.starts_with(prefix))
    {
        return Some(start);
    }
    // AQ.'s dot separates generic tokens, but belongs to this credential prefix.
    if start >= 3
        && &text.as_bytes()[start - 3..start] == b"AQ."
        && (start == 3 || !token_byte(text.as_bytes()[start - 4]))
    {
        return Some(start - 3);
    }
    None
}
pub struct Redactor {
    secrets: Vec<String>,
    pending: String,
}
impl Redactor {
    pub fn new<'a>(secrets: impl IntoIterator<Item = &'a str>) -> Self {
        let mut secrets: Vec<String> = secrets
            .into_iter()
            .filter(|secret| !secret.is_empty())
            .map(str::to_string)
            .collect();
        secrets.sort_by_key(|secret| std::cmp::Reverse(secret.len()));
        secrets.dedup();
        Self {
            secrets,
            pending: String::new(),
        }
    }
    pub fn push(&mut self, text: &str) -> String {
        self.pending.push_str(text);
        for secret in &self.secrets {
            // The marker is shorter than the minimum stored credential length.
            self.pending = self.pending.replace(secret, "[key]");
        }
        let mut split = self.pending.len().saturating_sub(
            self.secrets
                .first()
                .map_or(0, |secret| secret.len().saturating_sub(1)),
        );
        while !self.pending.is_char_boundary(split) {
            split = split.saturating_sub(1);
        }
        // Protect both an unfinished final token and a completed token bisected
        // by an exact-key suffix. Neither may leak a too-short generic fragment.
        for end in [self.pending.len(), split] {
            if let Some(start) = credential_prefix_start(&self.pending[..end]) {
                split = split.min(start);
            }
        }
        let rest = self.pending.split_off(split);
        std::mem::replace(&mut self.pending, rest)
    }
    pub fn pending_len(&self) -> usize {
        self.pending.len()
    }
    pub fn finish(&mut self) -> String {
        let mut pending = std::mem::take(&mut self.pending);
        for secret in &self.secrets {
            pending = pending.replace(secret, "[key]");
        }
        pending
    }
    /// Return buffered text that cannot still become a saved credential.
    /// The remaining suffix is deliberately retained and zeroized on drop.
    pub fn finish_cancelled(&mut self) -> String {
        let keep = self
            .secrets
            .iter()
            .map(|secret| {
                (1..secret.len())
                    .rev()
                    .find(|length| {
                        secret.is_char_boundary(*length)
                            && self.pending.ends_with(&secret[..*length])
                    })
                    .unwrap_or(0)
            })
            .max()
            .unwrap_or(0);
        let split = self.pending.len().saturating_sub(keep);
        let rest = self.pending.split_off(split);
        let safe = std::mem::replace(&mut self.pending, rest);
        safe
    }
}
impl Drop for Redactor {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.secrets.zeroize();
        self.pending.zeroize();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn frame(data: &str) -> Frame {
        Frame {
            data: data.into(),
            event: String::new(),
        }
    }
    #[test]
    fn every_byte_boundary_preserves_sse_unicode_and_crlf() {
        let fixture="event: response.output_text.delta\r\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"σ µ\"}\r\n\r\n";
        for boundary in 0..=fixture.len() {
            let mut decoder = Decoder::default();
            let mut frames = decoder.push(&fixture.as_bytes()[..boundary]).unwrap();
            frames.extend(decoder.push(&fixture.as_bytes()[boundary..]).unwrap());
            assert_eq!(frames.len(), 1);
            assert_eq!(
                decode(Provider::Openai, frames.remove(0)).unwrap().text,
                "σ µ"
            );
            decoder.finish().unwrap();
        }
    }
    #[test]
    fn malformed_error_frames_never_echo_provider_bodies() {
        assert!(decode(Provider::Gemini, frame("broken")).is_err());
        let error = decode(
            Provider::Anthropic,
            frame("{\"type\":\"error\",\"error\":{\"message\":\"fixture-secret\"}}"),
        )
        .err()
        .unwrap();
        assert!(!error.contains("fixture-secret"));
        let mut decoder = Decoder::default();
        assert!(decoder.push(&vec![b'x'; MAX_FRAME + 1]).is_err());
        let mut decoder = Decoder::default();
        decoder.push(b"data: {}\n").unwrap();
        assert!(decoder.finish().is_err());
    }
    #[test]
    fn native_provider_text_and_usage_fixtures() {
        let g=decode(Provider::Gemini,frame(r#"{"candidates":[{"content":{"parts":[{"text":"hidden","thought":true},{"text":"visible"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":4,"totalTokenCount":16}}"#)).unwrap();
        assert_eq!(g.text, "visible");
        assert!(g.done);
        assert_eq!(g.usage.unwrap().total_tokens, Some(16));
        let a = decode(
            Provider::Anthropic,
            frame(r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}"#),
        )
        .unwrap();
        assert_eq!(a.text, "Hello");
        let c = decode(
            Provider::Compatible,
            frame(r#"{"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}"#),
        )
        .unwrap();
        assert_eq!(c.text, "Hello");
        assert!(decode(Provider::Compatible, frame("[DONE]")).unwrap().done);
    }
    #[test]
    fn key_redaction_spans_every_text_boundary() {
        for secret in [
            "fixture-secret-only",
            "credential",
            "redacted",
            "sk-fixture-credential-1234567890",
            "AIza123456789012345678901234",
            "AQ.123456789012345678901234",
        ] {
            let input = format!("α {secret} ω");
            for boundary in input
                .char_indices()
                .map(|(i, _)| i)
                .chain(std::iter::once(input.len()))
            {
                let mut redactor = Redactor::new(Some(secret));
                let first = redactor.push(&input[..boundary]);
                let second = redactor.push(&input[boundary..]);
                let tail = redactor.finish();
                for output in [&first, &second, &tail] {
                    super::super::storage::reject_credentials(output, None).unwrap();
                }
                let result = first + &second + &tail;
                assert!(!result.contains(secret));
                assert!(result.contains("[key]"));
            }
        }
    }
    #[test]
    fn generic_credential_checks_see_whole_tokens_before_any_fragment_is_published() {
        for secret in [
            "sk-fixture-credential-1234567890".to_string(),
            format!("AIza{}", "x".repeat(24)),
            format!("AQ.{}", "x".repeat(24)),
        ] {
            let input = format!("Safe text. {secret} next");
            // Local endpoints have no selected credential, and unrelated token
            // formats must still be checked before crossing native IPC.
            for (boundary, selected) in (0..=input.len()).flat_map(|boundary| {
                [
                    None,
                    Some("unrelated-selected-credential-for-this-provider"),
                ]
                .into_iter()
                .map(move |selected| (boundary, selected))
            }) {
                let mut redactor = Redactor::new(selected);
                let mut published = String::new();
                let mut rejected = false;
                for chunk in [&input[..boundary], &input[boundary..]] {
                    let output = redactor.push(chunk);
                    if super::super::storage::reject_credentials(&output, None).is_err() {
                        rejected = true;
                        break;
                    }
                    published.push_str(&output);
                }
                if !rejected {
                    let output = redactor.finish();
                    rejected = super::super::storage::reject_credentials(&output, None).is_err();
                    if !rejected {
                        published.push_str(&output);
                    }
                }
                assert!(rejected);
                assert!(!published.contains("sk-"));
                assert!(!published.contains("AIza"));
                assert!(!published.contains("AQ."));
            }
        }
    }
    #[test]
    fn unfinished_credential_prefixes_report_buffer_bytes_without_delaying_normal_text() {
        let mut redactor = Redactor::new(None);
        assert_eq!(redactor.push("σ finite "), "σ finite ");
        assert_eq!(redactor.push("sk"), "");
        assert_eq!(redactor.pending_len(), 2);
        assert_eq!(redactor.push("etch"), "sketch");
        assert_eq!(redactor.push(" segment."), " segment.");
        assert_eq!(redactor.push(" Complete"), " Complete");
        assert_eq!(redactor.push("🙂x"), "🙂x");
        assert_eq!(redactor.finish(), "");
    }
    #[test]
    fn cancellation_flushes_safe_buffer_but_keeps_credential_prefix() {
        let secret = "x".repeat(4096);
        let mut redactor = Redactor::new(Some(secret.as_str()));
        assert_eq!(redactor.push("safe buffered text"), "");
        assert_eq!(redactor.finish_cancelled(), "safe buffered text");

        let mut redactor = Redactor::new(Some(secret.as_str()));
        let prefix = &secret[..64];
        assert_eq!(redactor.push(&format!("safe text {prefix}")), "");
        assert_eq!(redactor.finish_cancelled(), "safe text ");
        assert_eq!(redactor.pending_len(), prefix.len());
    }
}
