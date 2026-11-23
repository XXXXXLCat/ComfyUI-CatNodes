/* API-config parameter detection engine.

   Extracted verbatim from infcanvas-api-config.js (single IIFE, 3120 lines).
   All functions here are PURE with respect to module state: the topology
   detectors take `nodes` as an argument, and the two entry points take the
   state slices they need as arguments. Nothing reads window.InfCanvas, NS
   state, or the DOM, so this module can load before its consumer (ES import
   ordering guarantees evaluation before the parent IIFE runs).

   Kept out on purpose (still in the parent): offFields/setOffField/writeOffFields
   (need NS.prefs), the dialog shell, list I/O, preview, parameter editor and
   node-field inspector. */
/* Preview/zoom constants used by clampZoom; identical to the parent copy. */
const MIN_ZOOM = 0.2, MAX_ZOOM = 2;
/* ComfyUI 64-bit seed upper bound (see parent comment). */
const SEED_MAX = 18446744073709552000;

  /* Only real API nodes count. This project's bundled templates carry a few
     metadata keys (_kind / _name / kind / name / hint / _requires_config),
     which the reference project keeps in a separate manifest. */
  const META_KEYS = new Set(["kind", "name", "hint"]);
  function apiNodes(workflow) {
    if (!workflow || typeof workflow !== "object") return {};
    const out = {};
    for (const [id, value] of Object.entries(workflow)) {
      if (id.startsWith("_") || META_KEYS.has(id)) continue;
      if (value && typeof value === "object" && value.class_type) out[id] = value;
    }
    return out;
  }
  function isApiWorkflow(data) {
    return !!data && typeof data === "object" && !Array.isArray(data) &&
      Object.keys(apiNodes(data)).length > 0;
  }

  function hueOf(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360;
    return hash;
  }
  function guessType(value, key) {
    if (typeof value === "boolean") return "switch";
    if (typeof value === "number") return "number";
    const text = String(value || "");
    if (/text|prompt|string|caption/i.test(key) || text.includes("\n") || text.length > 40) return "textarea";
    return "text";
  }
  const toNum = (raw) => {
    if (raw === "" || raw === null || raw === undefined) return undefined;
    const num = Number(raw);
    return Number.isFinite(num) ? num : undefined;
  };
  const clampZoom = (z) => Math.min(Math.max(z, MIN_ZOOM), MAX_ZOOM);
  /* 「高级参数」判定。新字段一律带 stage,按链路阶段分:
       普通 = 提示词(PROMPT) / 尺寸(SIZE) / 开关(SWITCH) / Seed;
       高级 = 生成参数(GENERATE) / 采样器其余(Steps/CFG/Sampler/Scheduler)。
     Seed 虽属采样阶段,但单独当普通参数。用 stage 而非 label 判定,是因为
     Switch 的 label 是动态的(如 Boolean (Split Latent)/重写提示词),没法枚举。
     老字段(没有 stage,也没 advanced 布尔值)走下面的 label 白名单兜底——
     中英并存,兼容 label 英文化前的旧文件。和 infcanvas-flow.js 的 BASIC_LABELS
     是同一张表,两边不一致会出现「勾选框没勾、节点里却藏着」。
     用户的勾选一旦落到 fields.json,就以文件里的布尔值为准。 */
  const LEGACY_BASIC_LABELS = [
    "field.promptEnhancement", "field.prompt", "field.aspectRatio", "field.megapixels", "field.upscaleFactor", "field.seed",
    "Prompt", "Style", "Lyrics", "Caption",
    "Aspect Ratio", "Megapixels", "Multiple", "Width", "Height", "Seed",
  ];
  const defaultAdvanced = (label, stage) => {
    const name = String(label || "").trim();
    if (typeof stage === "number") {
      if (stage === STAGE.PROMPT || stage === STAGE.SIZE || stage === STAGE.SWITCH) return false;
      if (stage === STAGE.GENERATE) return true;
      if (stage === STAGE.SAMPLER) return name !== "Seed";
    }
    return !LEGACY_BASIC_LABELS.includes(name);
  };
  /* 可读英文标签:默认从端口名自动生成,不引入中文。个别端口用规则里的固定
     label 覆盖(sampler_name -> "Sampler")。cfg -> "CFG"; on_false -> "On False"。 */
  const ACRONYMS = /^(cfg|mp|vae|llm|tts|h3|url|id)$/i;
  /* 提示词里少数端口自带明确语义,label 保留端口名原文(经 humanLabel 可读化);
     其余通用端口(value/text/on_false/prompt…)一律显示 Prompt。 */
  const SEMANTIC_PROMPT_PORT = /^(style|lyrics|caption)$/i;
  function humanLabel(key) {
    return String(key).split(/[._-]+/).filter(Boolean)
      .map((w) => ACRONYMS.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))
      .join(" ");
  }

  /* 强特征 key 也按「先认节点,再认端口」:每类参数只在自己的节点身份上认。
     采样器:seed/steps/cfg/sampler/scheduler;Generate:max_length/thinking。
     都限定节点后,别的节点上同名的端口(cfg_scale/LLM 的 max_tokens…)就不会
     被误认。宽高三参数(aspect_ratio/megapixels/multiple)不走这张全局表,
     改由下面的 topologyResolution 从采样器 latent 反推——全局按节点名扫会
     把武戏里 6 个 ImageScaleByAspectRatio 预处理节点也卷进来。 */
  const SAMPLER_NODE = /^(KSampler|KSamplerAdvanced|SamplerCustom|SamplerCustomAdvanced|KSamplerSelect|BasicScheduler|SchedulerDynamic|MiniMaxH3.*Sampler.*|.*Sampler.*T8)$/i;
  const RESOLUTION_NODE = /^(Resolution.*Selector|.*FitImageToSize|.*ImageScaleByAspectRatio.*)$/i;
  const GENERATE_NODE = /Generate/i;

  /* 拓扑尺寸命中的 Resolver 节点上要暴露的字段（label 走 humanLabel 自动
     生成:aspect_ratio -> Aspect Ratio / megapixels -> Megapixels / multiple
     -> Multiple）。 */
  const RESOLUTION_FIELDS = [
    { key: /^(aspect_?ratio|ratio)$/i, type: "select" },
    { key: /^(mega_?pixels?|mp)$/i, type: "number" },
    { key: /^(multiple|multiple_of|round_to|align(ment)?)$/i, type: "number" },
  ];

  /* 暴露字段按链路流程分组排序(STAGE,小在前,同组保持稳定顺序):
       0 提示词/文本 → 1 生成参数(LLM) → 2 尺寸 → 3 开关 → 4 采样器。
     规则自带 stage,兜底命中也沿用本规则的阶段。 */
  const STAGE = { PROMPT: 0, GENERATE: 1, SIZE: 2, SWITCH: 3, SAMPLER: 4 };

  const STRONG_KEYS = [
    /* cfg 端口名收窄:采样器上就叫 cfg;cfg_scale/guidance_scale 是音乐/Guide
       节点的自有参数,不再认作采样参数。 */
    { key: /^(seed|noise_seed)$/i, label: "Seed", type: "random", nodeTest: SAMPLER_NODE, stage: STAGE.SAMPLER },
    { key: /^steps$/i, type: "slider", nodeTest: SAMPLER_NODE, stage: STAGE.SAMPLER },
    { key: /^cfg$/i, type: "slider", nodeTest: SAMPLER_NODE, stage: STAGE.SAMPLER },
    { key: /^(sampler_name|sampler)$/i, label: "Sampler", type: "select", nodeTest: SAMPLER_NODE, stage: STAGE.SAMPLER },
    { key: /^(scheduler|scheduler_name|noise_scheduler)$/i, type: "select", nodeTest: SAMPLER_NODE, stage: STAGE.SAMPLER },
    { key: /^max_?(length|tokens|new_tokens)$/i, type: "number", nodeTest: GENERATE_NODE, stage: STAGE.GENERATE },
    { key: /^(thinking|thinking_mode|enable_thinking|think)$/i, type: "switch", nodeTest: GENERATE_NODE, stage: STAGE.GENERATE },
  ];

  /* 提示词一律由上面的拓扑层判定（接口锚点 + 连线前推），不读 title、不读
     文本语气 —— 名称和内容都能被工作流作者随手改写，不可靠。这里只保留按
     class_type + 端口名这种「接口身份」就能确定的非提示词/专用文本字段。
     test 命中节点身份；fields 是白名单，没列出的 key 一概不碰。 */
  const NODE_ROLES = [
    {
      /* BreezeTTS2 的 instruction 是通用文本端口,label 由端口名自动生成。
         音乐类(style/caption/lyrics)一律走拓扑层,不在这里做映射。 */
      test: ({ classType }) => /^BreezeTTS2Voice(Design|Direction)$/i.test(classType),
      fields: [{ key: /^instruction$/i, type: "textarea" }],
    },
  ];
  /* object_info is the only place a combo's option list and a number's range
     live — a workflow JSON just stores the CURRENT value. Fetched once per
     session (ComfyUI caches it server-side as well). */
  let defsPromise = null;
  function nodeDefs() {
    if (!defsPromise) {
      defsPromise = (async () => {
        try {
          const api = window.comfyAPI?.api?.api;
          return (api?.getNodeDefs ? await api.getNodeDefs() : null) || {};
        } catch (_) {
          return {};
        }
      })();
    }
    return defsPromise;
  }
  /* Newer ComfyUI ships combos as ["COMBO", {options:[...]}]; older ones inline
     the option array as the type. Both are handled. */
  function inputSpec(defs, classType, key) {
    const input = defs?.[classType]?.input;
    const raw = input?.required?.[key] || input?.optional?.[key];
    if (!Array.isArray(raw)) return {};
    const [type, options] = raw;
    if (Array.isArray(type)) return { kind: "COMBO", options: type.filter((v) => typeof v === "string") };
    const spec = { kind: String(type || "") };
    if (options && typeof options === "object") {
      if (Array.isArray(options.options)) spec.options = options.options.filter((v) => typeof v === "string");
      for (const numeric of ["min", "max", "step"]) {
        if (typeof options[numeric] === "number" && Number.isFinite(options[numeric])) spec[numeric] = options[numeric];
      }
    }
    return spec;
  }
  const fieldKey = (nodeId, key) => String(nodeId) + ":" + String(key);
  /* Inputs the default-parameter pass must LEAVE ALONE. A text-generation node
     (TextGenerate / TextGenerateV2) carries its own LLM decode seed in
     `sampling_mode.seed`; that belongs to the model's sampling setup, not to
     the image's noise, so auto-exposing it would only add a second, meaningless
     随机种子 next to the KSampler's. It is only skipped by the DETECTOR -- the
     node inspector still lists it, so the user can tick it by hand when a
     particular workflow actually wants it. */
  function autoExcluded({ key, classType }) {
    return /^TextGenerate/i.test(classType || "") && /(^|\.)seed$/i.test(key || "");
  }
  /* --------------------- topology prompt detection ---------------------

     提示词不再靠 title 猜。锚点 = 真正"消费提示词"的生成节点，从锚点的提示
     词端口沿连线一路前推到源头字面量；多条链路汇聚同一源头 = 强证据(hit 计数)。

     绝不替用户决定"哪个才是真提示词":并列最高 hit 的候选全部暴露成"field.prompt"
     字段，让用户自己选填哪个(例: Krea-2 的系统模板与真实提示词都 hit2)。
     只有从锚点追溯不到任何源头时，才退回下面的 NODE_ROLES title 识别。 */
  const PROMPT_ANCHORS = [
    { type: /^TextGenerate/i, port: /^prompt$/i },
    { type: /^TextEncodeQwen/i, port: /^prompt$/i },
    { type: /^MiniMaxH3.*ToVideo$/i, port: /^prompt$/i },
    { type: /^KSampler$/i, port: /^positive$/i },
    /* H3 武戏：音频条件节点的 prompt 也是生成锚点，上游经 Concat/LLM 到 CR Prompt Text。 */
    { type: /^MiniMaxH3AudioConditioningT8$/i, port: /^prompt$/i },
  ];
  const PROMPT_SOURCES = [
    { type: /^PrimitiveStringMultiline$/i, port: /^value$/i },
    { type: /^CR Prompt Text$/i, port: /^prompt$/i },
    { type: /^MOSSImageLayoutPrompt$/i, port: /^prompt$/i },
    { type: /^TextGenerate/i, port: /^prompt$/i },
    { type: /^TextEncodeQwen/i, port: /^prompt$/i },
    { type: /^MiniMaxH3.*ToVideo$/i, port: /^prompt$/i },
    { type: /^CLIPTextEncode$/i, port: /^text$/i },
    /* 音乐：文本编码/生成节点自身的端口就是用户编辑的提示词/歌词/风格。 */
    { type: /^MiniMaxMusic3TextEncode$/i, port: /^(caption|lyrics)$/i },
    { type: /^YuE2GenerateMusic$/i, port: /^(style|lyrics)$/i },
  ];
  const NO_PROMPT_LINK = /^(clip|clip_vision|vae|audio_vae|model|negative|negative_prompt|latent_image|control|style_model|seed|noise_seed|width|height|length|element|system_prompt|image|images|ref_image|audio|video)$/i;
  const MIDDLE_PROMPT_NODE = /Concatenate|ConcatText|Replace|Switch|JsonExtract|PreviewAny|RH_LLMAPI/i;
  const isPromptLink = (v) => Array.isArray(v) && v.length >= 1
    && (typeof v[0] === "string" || typeof v[0] === "number");

  /* 音乐节点的语义化端口(style/caption/lyrics):端口名原文即语义,透传给上游
     通用文本源头(如 PrimitiveString.value),让两个 value 能显示成 Style/Lyrics。 */
  const SEMANTIC_PORT = /^(lyrics|style|caption)$/i;
  const MUSIC_NODE = /^(YuE2GenerateMusic|YuE2GenerateABC|MiniMaxMusic3TextEncode)$/i;

  function promptSourceLiterals(nodeId, node) {
    const hits = [];
    const ct = node.class_type || "";
    for (const { type, port } of PROMPT_SOURCES) {
      if (!type.test(ct)) continue;
      for (const [k, v] of Object.entries(node.inputs || {})) {
        if (port.test(k) && typeof v === "string") hits.push([String(nodeId), k, v]);
      }
    }
    return hits;
  }

  function tracePromptSource(nodeId, nodes, visited, depth) {
    const out = [];
    const key = String(nodeId);
    if (depth > 24 || visited.has(key)) return out;
    const seen = new Set(visited);
    seen.add(key);
    const node = nodes[key];
    if (!node || typeof node !== "object" || !node.class_type) return out;
    const ins = node.inputs || {};
    const lit = promptSourceLiterals(key, node);
    const isMiddle = MIDDLE_PROMPT_NODE.test(node.class_type);

    /* Switch: 跟选中分支；选中分支缺失/未连接时退回另一条存在的分支。 */
    if ("switch" in ins && ("on_true" in ins || "on_false" in ins)) {
      let branch = ins.switch ? "on_true" : "on_false";
      let tgt = ins[branch];
      if (!(isPromptLink(tgt) || typeof tgt === "string")) {
        for (const alt of ["on_true", "on_false"]) {
          const cand = ins[alt];
          if (isPromptLink(cand) || typeof cand === "string") {
            tgt = cand; branch = alt; break;
          }
        }
      }
      if (isPromptLink(tgt)) return tracePromptSource(tgt[0], nodes, seen, depth + 1);
      if (typeof tgt === "string") return [[key, branch, tgt]];
    }

    if (lit.length && !isMiddle) return lit;
    const upstream = [];
    for (const [k, v] of Object.entries(ins)) {
      if (isPromptLink(v) && !NO_PROMPT_LINK.test(k)) {
        const sub = tracePromptSource(v[0], nodes, seen, depth + 1);
        /* 音乐节点: 把语义化端口名(style/lyrics/caption)透传给上游通用文本源头,
           让两个 PrimitiveString.value 显示成 Style/Lyrics,而不是都叫 Value。 */
        if (MUSIC_NODE.test(node.class_type || "") && SEMANTIC_PORT.test(k)) {
          for (const s of sub) if (!s[3]) s[3] = k;
        }
        upstream.push(...sub);
      }
    }
    if (upstream.length) return upstream;
    return lit;
  }

  /* 返回并列最高 hit 的源头 [{nodeId,key,semantic}]，追溯不到则空数组。
     semantic 是透传来的语义化端口名(style/lyrics/caption)，非音乐为 null。 */
  function topologyPrompts(nodes) {
    const hits = new Map();
    for (const [nodeId, node] of Object.entries(nodes)) {
      const ct = node.class_type || "";
      for (const { type, port } of PROMPT_ANCHORS) {
        if (!type.test(ct)) continue;
        for (const [k, v] of Object.entries(node.inputs || {})) {
          if (!port.test(k)) continue;
          let sources = [];
          if (isPromptLink(v)) sources = tracePromptSource(v[0], nodes, new Set(), 0);
          else if (typeof v === "string") sources = [[String(nodeId), k, v]];
          for (const [sid, skey, , sem] of sources) {
            const id = sid + ":" + skey;
            const prev = hits.get(id);
            /* 同一源头被多链路命中：count 累加；semantic 一旦有值就保留。 */
            hits.set(id, {
              count: (prev?.count || 0) + 1,
              semantic: prev?.semantic || sem || null,
            });
          }
        }
      }
    }
    if (!hits.size) return [];
    const top = Math.max(...[...hits.values()].map((h) => h.count));
    const out = [];
    for (const [id, h] of hits) {
      if (h.count !== top) continue;
      const i = id.lastIndexOf(":");
      out.push({ nodeId: id.slice(0, i), key: id.slice(i + 1), semantic: h.semantic });
    }
    return out;
  }

  /* --------------------- topology size detection ---------------------
     宽高参数不再按节点名全局扫——武戏里 6 个 ImageScaleByAspectRatio 预处理
     节点都带 aspect_ratio="original",全局扫会把它们全卷进来。真值路径是从
     采样器的 latent_image 输入前推到 latent 源头,源头节点的 width/height
     才是最终尺寸:
       - width/height 是字面量 -> 暴露 Width / Height;
       - width/height 是 link,前推到 Resolution/Fit 节点 -> 暴露它的
         Megapixels / Aspect Ratio / Multiple。
     中转(Switch / PrimitiveInt)沿 link 前推;Switch 两个分支都看,任一支能
     到 Resolver 即命中(和提示词平局同一哲学:不确定就都给)。 */
  function topologySize(nodes) {
    const LATENT_INPUT = /^latent_image$/i;
    const SIZE_PORT = /^(width|height)$/i;
    const sizePorts = (node) => Object.entries(node.inputs || {}).filter(([k]) => SIZE_PORT.test(k));
    const switchBranches = (ins) => {
      if (!("switch" in ins)) return null;
      const b = [];
      for (const p of ["on_true", "on_false"]) if (p in ins) b.push(ins[p]);
      return b.length ? b : null;
    };

    /* 从 latent 源头前推,找到真正带 width/height 的节点(过 Switch)。 */
    const findSizeNode = (nid, visited, depth) => {
      if (depth > 8 || visited.has(nid)) return null;
      visited.add(nid);
      const node = nodes[nid];
      if (!node || !node.class_type) return null;
      if (sizePorts(node).length) return { id: nid, node };
      const br = switchBranches(node.inputs || {});
      if (br) {
        for (const b of br) {
          if (!isPromptLink(b)) continue;
          const r = findSizeNode(String(b[0]), new Set(visited), depth + 1);
          if (r) return r;
        }
      }
      return null;
    };

    /* 从 width/height 的值前推,收集 Resolver 节点 id 与字面量值。 */
    const traceSize = (value, visited, depth, found) => {
      if (depth > 12) return;
      if (typeof value === "number" && Number.isFinite(value)) { found.literals.add(value); return; }
      if (!isPromptLink(value)) return;
      const nid = String(value[0]);
      if (visited.has(nid)) return;
      visited.add(nid);
      const node = nodes[nid];
      if (!node || !node.class_type) return;
      if (RESOLUTION_NODE.test(node.class_type)) { found.resolvers.add(nid); return; }
      const ins = node.inputs || {};
      const br = switchBranches(ins);
      if (br) {
        for (const b of br) traceSize(b, new Set(visited), depth + 1, found);
        return;
      }
      if ("value" in ins) traceSize(ins.value, visited, depth + 1, found);
      for (const [, v] of sizePorts(node)) traceSize(v, new Set(visited), depth + 1, found);
    };

    /* 入口:所有采样器的 latent_image -> latent 源头 -> sizeNode。 */
    const sizeNodes = new Map();
    for (const node of Object.values(nodes)) {
      if (!SAMPLER_NODE.test(node.class_type || "")) continue;
      for (const [k, v] of Object.entries(node.inputs || {})) {
        if (!LATENT_INPUT.test(k) || !isPromptLink(v)) continue;
        const s = findSizeNode(String(v[0]), new Set(), 0);
        if (s) sizeNodes.set(s.id, s.node);
      }
    }

    const resolvers = new Set();
    const literals = [];
    for (const [sid, snode] of sizeNodes) {
      for (const [key, value] of sizePorts(snode)) {
        if (typeof value === "number" && Number.isFinite(value)) {
          literals.push({ nodeId: sid, classType: snode.class_type || "", key, value });
          continue;
        }
        if (!isPromptLink(value)) continue;
        const found = { resolvers: new Set(), literals: new Set() };
        traceSize(value, new Set(), 0, found);
        if (found.resolvers.size) {
          for (const rid of found.resolvers) resolvers.add(rid);
        } else if (found.literals.size) {
          const v = [...found.literals][0];
          literals.push({ nodeId: sid, classType: snode.class_type || "", key, value: v });
        }
      }
    }

    const out = [];
    const emitted = new Set();
    const push = (c) => {
      const id = c.nodeId + ":" + c.key;
      if (emitted.has(id)) return;
      emitted.add(id);
      out.push(c);
    };
    for (const rid of resolvers) {
      const rnode = nodes[rid];
      if (!rnode) continue;
      for (const f of RESOLUTION_FIELDS) {
        for (const [key, value] of Object.entries(rnode.inputs || {})) {
          if (!f.key.test(key) || Array.isArray(value) || (value && typeof value === "object")) continue;
          push({ nodeId: rid, key, value, classType: rnode.class_type || "", label: humanLabel(key), type: f.type });
        }
      }
    }
    for (const l of literals) {
      push({ ...l, label: humanLabel(l.key), type: "number" });
    }
    return out;
  }

  /* --------------------- topology switch detection ---------------------
     If/Else Switch(ComfySwitchNode)的切换端口要暴露成一个开关。三种形态,
     都按「控制源」归并 —— 多个 switch 由同一个源头控制时只出一个字段:
       a) switch 端口是 link,前推到上游值节点(通常 PrimitiveBoolean):
          label 用源头节点 _meta.title(如 "Boolean (Split Latent)"),写回源头
          节点的 value —— 天然联动所有指向它的 switch。
       b) switch 端口是字面量,但 _meta.sourceLabels.switch 有值(子图输入被
          转换器固化,如 custom_size):多个 switch 共享该 label 归并成一个字段,
          label 用 sourceLabel 可读化("Custom Size"),写回代表 switch 节点。
       c) 纯字面量且无 sourceLabel:直接暴露这个 switch 端口,每个节点一个字段,
          label 用节点语义 title,否则 "Switch"。
     节点身份由 class_type 确定,title 只作 label,不用于判断是否暴露。 */
  function topologySwitch(nodes) {
    const SWITCH_NODE = /^ComfySwitchNode$/i;
    const groups = new Map();
    const put = (key, cand) => { if (!groups.has(key)) groups.set(key, cand); };

    for (const [nodeId, node] of Object.entries(nodes)) {
      if (!SWITCH_NODE.test(node.class_type || "")) continue;
      const ins = node.inputs || {};
      if (!("switch" in ins)) continue;
      const sw = ins.switch;
      const meta = node._meta || {};

      if (isPromptLink(sw)) {
        /* 沿 value 端口前推到最终值节点(可能套了几层 Primitive/Reroute)。 */
        let upId = String(sw[0]);
        let up = nodes[upId];
        const seen = new Set([upId]);
        let guard = 0;
        while (up && isPromptLink((up.inputs || {}).value) && guard++ < 8) {
          upId = String(up.inputs.value[0]);
          if (seen.has(upId)) break;
          seen.add(upId);
          up = nodes[upId];
        }
        const uv = up && (up.inputs || {}).value;
        if (up && up.class_type && typeof uv === "boolean") {
          const title = (up._meta || {}).title;
          put("src:" + upId + ":value", {
            nodeId: upId, key: "value", value: uv, classType: up.class_type,
            label: (title && title !== up.class_type) ? title : "Switch", type: "switch",
          });
          continue;
        }
        /* 上游缺节点或接到子图外 —— 退回暴露本节点 switch 端口。 */
      }

      const sourceLabel = (meta.sourceLabels || {}).switch;
      if (sourceLabel) {
        put("label:" + sourceLabel, {
          nodeId, key: "switch", value: typeof sw === "boolean" ? sw : false,
          classType: node.class_type, label: humanLabel(sourceLabel), type: "switch",
        });
      } else {
        const title = meta.title;
        put("node:" + nodeId, {
          nodeId, key: "switch", value: typeof sw === "boolean" ? sw : false,
          classType: node.class_type,
          label: (title && title !== node.class_type) ? title : "Switch", type: "switch",
        });
      }
    }
    return [...groups.values()];
  }
  /* Literal inputs of the open workflow recognised by the node-first pass.
     Links (arrays) and nested objects cannot be edited in a form, and rows the
     user unticked earlier are skipped. A node:key is emitted at most once —
     topology prompt first, then STRONG_KEYS, then the first matching role. */
export function autoCandidates(nodes, fields, off) {
    const taken = new Set(fields.map((field) => fieldKey(field.nodeId, field.key)));
    const out = [];
    const matched = new Set();
    const add = (nodeId, classType, key, value, label, type, stage = STAGE.SAMPLER) => {
      const id = fieldKey(nodeId, key);
      if (matched.has(id) || taken.has(id) || off.has(id)) return;
      if (autoExcluded({ key, classType })) return;
      matched.add(id);
      out.push({ nodeId, key, value, classType, label, type, stage });
    };

    /* Layer 0: 拓扑提示词 —— 并列最高的源头全部暴露，让用户自己选。
       语义端口(style/lyrics/caption)保留端口名原文;通用端口(value/text/
       on_false/prompt…)语义就是"field.prompt",统一显示 Prompt。semantic 是上游
       透传的语义端口名,优先用它(文生音乐 Yue2 的 value 源头靠它拿到 style/
       lyrics);没有时退回源头端口名本身。 */
    for (const { nodeId, key, semantic } of topologyPrompts(nodes)) {
      const node = nodes[nodeId];
      if (!node) continue;
      const semanticPort = (semantic || key);
      const promptLabel = SEMANTIC_PROMPT_PORT.test(semanticPort)
        ? humanLabel(semanticPort) : "Prompt";
      add(nodeId, node.class_type || "", key, (node.inputs || {})[key], promptLabel, "textarea", STAGE.PROMPT);
    }

    /* Layer 0.5: 拓扑尺寸 —— 从采样器 latent 前推,源头 width/height 字面量
       暴露 Width/Height;接到 Resolver 则暴露它的 Megapixels/Aspect Ratio/
       Multiple。label/type 已由 topologySize 算好。 */
    for (const c of topologySize(nodes)) {
      add(c.nodeId, c.classType, c.key, c.value, c.label, c.type, STAGE.SIZE);
    }

    /* Layer 0.6: 拓扑 Switch —— 切换端口按控制源归并成一个字段。 */
    for (const c of topologySwitch(nodes)) {
      add(c.nodeId, c.classType, c.key, c.value, c.label, c.type, STAGE.SWITCH);
    }

    /* Layer 1: 强特征 key 两级优先级 —— 每条规则各自先在「规定节点」
       (nodeTest)上找，规定节点上一条都没找到时，才对这条规则放宽到全局
       按 key 找。按规则粒度 rather than 整层：一个工作流有 KSampler 不该
       连别的参数类型一起丢掉。
       于是有采样器时 seed/cfg 仍只认采样器上的（音乐 cfg_scale / LLM
       max_tokens / 缩放 ratio 不会被误认）；而像 MingGenerate 这种自带
       seed/cfg、却没有采样器节点的工作流，也能在兜底那一级拿到。 */
    for (const rule of STRONG_KEYS) {
      const inNode = [];   // 规定节点上命中
      const anywhere = []; // 其他节点上命中（兜底）
      for (const [nodeId, node] of Object.entries(nodes)) {
        const classType = node.class_type || "";
        const pairs = Object.entries(node.inputs || {}).filter(
          ([, value]) => !Array.isArray(value) && !(value !== null && typeof value === "object"),
        );
        for (const [key, value] of pairs) {
          if (!rule.key.test(key)) continue;
          const h = { nodeId, classType, key, value };
          if (!rule.nodeTest || rule.nodeTest.test(classType)) inNode.push(h);
          else anywhere.push(h);
        }
      }
      for (const h of (inNode.length ? inNode : anywhere)) {
        add(h.nodeId, h.classType, h.key, h.value, rule.label || humanLabel(h.key), rule.type, rule.stage);
      }
    }

    /* Layer 2: 接口的端口名就能确定的专用文本字段（音乐歌词/风格等）。
       不读 title、不读 value 内容。node:key 已被拓扑占位的由 `add` 去重。 */
    for (const [nodeId, node] of Object.entries(nodes)) {
      const classType = node.class_type || "";
      const pairs = Object.entries(node.inputs || {}).filter(
        ([, value]) => !Array.isArray(value) && !(value !== null && typeof value === "object"),
      );
      for (const role of NODE_ROLES) {
        if (!role.test({ key: "", value: null, classType })) continue;
        for (const field of role.fields) {
          if (!field.key.test) continue;
          for (const [key, value] of pairs) {
            if (!field.key.test(key)) continue;
            if (typeof value !== "string" && typeof value !== "boolean") continue;
            add(nodeId, classType, key, value, humanLabel(key),
              field.typeFromValue ? (typeof value === "boolean" ? "switch" : "textarea") : field.type, STAGE.PROMPT);
          }
        }
      }
    }
    /* 按链路流程稳定排序:提示词→生成参数→尺寸→开关→采样器。
       Array#sort 在 ES2019 起保证稳定,同组维持识别时的相对顺序。 */
    out.sort((a, b) => a.stage - b.stage);
    return out;
  }
  /* Turn the candidates into persisted field rows, pulling options / ranges
     from the node definition. Labels and types are already decided above. */
export async function detectFields(nodes, fields, off) {
    const candidates = autoCandidates(nodes, fields, off);
    if (!candidates.length) return [];
    const defs = await nodeDefs();
    return candidates.map(({ nodeId, key, value, classType, label, type, stage }) => {
      const spec = inputSpec(defs, classType, key);
      const field = { nodeId, key, type, label, advanced: defaultAdvanced(label, stage) };
      if (type === "select") {
        const options = spec.options?.length ? spec.options
          : (typeof value === "string" && value ? [value] : []);
        if (options.length) field.options = options;
      }
      if (type === "number" || type === "slider" || type === "random") {
        let { min, max, step } = spec;
        /* Seeds are 64-bit upstream: object_info reports 2^64-1 and the workflow
           templates already carry values like 4.4e14. Keep that range -- forcing
           32 bits made a scrub jump five orders of magnitude on open. */
        if (type === "random") {
          if (!Number.isFinite(min) || min < 0) min = 0;
          if (!Number.isFinite(max) || max <= min) max = SEED_MAX;
          step = 1;
        }
        if (typeof min === "number") field.min = min;
        if (typeof max === "number") field.max = max;
        /* object_info omits `step` for plain INT/FLOAT inputs; the panel's
           scrubber needs one regardless. */
        field.step = typeof step === "number" ? step : (spec.kind === "FLOAT" ? 0.01 : 1);
      }
      return field;
    });
  }
/* R (refresh node definitions): drop the session object_info cache. */
export function refreshDefs() { defsPromise = null; }

export {
  apiNodes, isApiWorkflow, hueOf, guessType, toNum, clampZoom,
  humanLabel, inputSpec, fieldKey, autoExcluded, defaultAdvanced,
  STAGE, SEED_MAX,
};