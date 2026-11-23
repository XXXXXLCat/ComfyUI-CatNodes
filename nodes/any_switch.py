# -*- coding: utf-8 -*-
"""Any Switch 🐈‍⬛ — forward the one branch that actually carries data.

Uses the official V3 Autogrow + MatchType pair: ports grow as they are wired,
the first connection fixes the data type for every port and the output, and no
custom front-end script is needed. An unexecuted branch arrives as None or as
an ExecutionBlocker; both count as empty.
"""

from comfy_api.latest import io

try:
    from comfy_execution.graph import ExecutionBlocker
except Exception:  # schema-only checks outside a running ComfyUI
    ExecutionBlocker = ()


_MAX_SLOTS = 9


def _carries_data(value):
    if value is None:
        return False
    if ExecutionBlocker and isinstance(value, ExecutionBlocker):
        return False
    return True


class CatAnySwitch(io.ComfyNode):
    """Forward the single populated input; error on zero or many — any type."""

    @classmethod
    def define_schema(cls):
        template = io.MatchType.Template("cat_any_switch")
        return io.Schema(
            node_id="🐈‍⬛CatAnySwitch",
            display_name="Any Switch 🐈‍⬛",
            category="🐈‍⬛CatNodes/switch",
            description=(
                "Type-safe single-active-input switch. Wire several branch outputs at once; "
                "the connected type locks all ports and the output. At runtime the node "
                "forwards the one input that carries data and raises an error if none or "
                "more than one is populated. Ports grow as you connect, up to nine."
            ),
            inputs=[
                io.Autogrow.Input(
                    "inputs",
                    template=io.Autogrow.TemplatePrefix(
                        input=io.MatchType.Input(
                            "input",
                            template=template,
                            tooltip="Candidate branch; only one may carry data at a time.",
                        ),
                        prefix="input_",
                        min=1,
                        max=_MAX_SLOTS,
                    ),
                    display_name="branches",
                    tooltip="Connect one or more branches; exactly one must produce a value.",
                ),
            ],
            outputs=[io.MatchType.Output(template=template, display_name="output")],
        )

    @classmethod
    def execute(cls, inputs: io.Autogrow.Type):
        present = [
            (name, value)
            for name, value in (inputs or {}).items()
            if _carries_data(value)
        ]
        if not present:
            raise ValueError(
                "Any Switch 🐈‍⬛: no input carried data. Exactly one branch must produce a value."
            )
        if len(present) > 1:
            names = ", ".join(name for name, _ in present)
            raise ValueError(
                f"Any Switch 🐈‍⬛: more than one input carried data ({names}). "
                "Only one branch may produce a value at a time."
            )
        return io.NodeOutput(present[0][1])
