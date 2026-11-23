/* Vue Flow canvas CSS + injection. The stylesheet source lives in
   web/css/infcanvas-vueflow.css and is compiled into a string by the
   infcanvas-style.js build (batch 8). VUEFLOW_CSS comes from the vendor bundle
   and is concatenated here at injection time. */
import { VUEFLOW_CSS } from "./vendor/vueflow.bundle.mjs";
import { CSS_VUEFLOW as CSS } from "./infcanvas-style.js";

function injectStyles() {
  if (document.getElementById("infcanvas-vueflow-style")) return;
  const style = document.createElement("style");
  style.id = "infcanvas-vueflow-style";
  style.textContent = VUEFLOW_CSS + "\n" + CSS;
  document.head.appendChild(style);
}

export { injectStyles };
