# -*- coding: utf-8 -*-
"""Group Control 🐈‍⬛ — pass-through shell for the group switching panel.

The companion front-end script lists canvas groups and toggles their members
between run / bypass / mute. Backend execution only relays the optional signal
so the node can sit inside a data chain without changing it.
"""

from comfy_api.latest import io


class CatGroupControl(io.ComfyNode):
    """One panel to open or close whole canvas groups at once."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="🐈‍⬛CatGroupControl",
            display_name="Group Control 🐈‍⬛",
            category="🐈‍⬛CatNodes/group",
            description=(
                "Open or close canvas groups from one panel. Each group becomes a row "
                "with a toggle; filter by colour and name, order by name or position, "
                "and choose free / always-one / at-most-one / at-least-one interaction. "
                "Closing a group bypasses or mutes its members. The signal input is a "
                "pass-through; all switching happens in the front end."
            ),
            inputs=[
                io.AnyType.Input(
                    "signal",
                    optional=True,
                    display_name="signal",
                    tooltip="Optional pass-through value; not involved in group switching.",
                ),
            ],
            outputs=[io.AnyType.Output(display_name="signal")],
        )

    @classmethod
    def execute(cls, signal=None, **kwargs):
        return io.NodeOutput(signal)
