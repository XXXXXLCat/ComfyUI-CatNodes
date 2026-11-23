# -*- coding: utf-8 -*-
"""Node Control 🐈‍⬛ — pass-through shell for the node switching panel.

Shares the panel engine with Group Control but targets individual canvas nodes.
Notes, reroutes, primitives and the control node itself are excluded in the
front end. Backend execution only relays the optional signal.
"""

from comfy_api.latest import io


class CatNodeControl(io.ComfyNode):
    """One panel to open or close individual canvas nodes at once."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="🐈‍⬛CatNodeControl",
            display_name="Node Control 🐈‍⬛",
            category="🐈‍⬛CatNodes/node",
            description=(
                "Open or close individual canvas nodes from one panel. Filter by colour "
                "(uncoloured nodes inherit their group's colour) and by name/type "
                "keywords; order by name or position; choose how toggles interact. "
                "Closing a node bypasses or mutes it. The signal input is a pass-through; "
                "all switching happens in the front end."
            ),
            inputs=[
                io.AnyType.Input(
                    "signal",
                    optional=True,
                    display_name="signal",
                    tooltip="Optional pass-through value; not involved in node switching.",
                ),
            ],
            outputs=[io.AnyType.Output(display_name="signal")],
        )

    @classmethod
    def execute(cls, signal=None, **kwargs):
        return io.NodeOutput(signal)
