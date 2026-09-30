"""Semantic boundary identities survive meshing and method selection."""

SOLID_REGIONS = {
    "box": ("x0", "x1", "y0", "y1", "z0", "z1"),
    "cylinder": ("x0", "x1", "outer"),
    "bracket": ("x0", "x1", "y0", "y1", "z0", "z1", "inner-x", "inner-y"),
}
PLANAR_REGIONS = ("x0", "x1", "y0", "y1")
