/* Shared node components: the tag palette and the wired-asset row.
   Extracted from infcanvas-flow.js (batch 1a). videoThumbs ownership
   moved here; infcanvas-flow.js imports the SAME reactive object. */
import { Vue as VueNS } from "./vendor/vueflow.bundle.mjs";
import { IcIcon } from "./flow-icons.js";
import {
  KIND_CN,
  NODE_TAGS,
  fmtTime,
} from "./flow-rules.js";
const { ref, reactive } = VueNS;
  const t = (key, params) => (window.InfCanvas?.i18n ? window.InfCanvas.i18n.t(key, params) : key);

  export const videoThumbs = reactive({});      // url -> dataURL, reactive store read by templates

  export const TagMenu = {
    name: "TagMenu",
    components: { IcIcon },
    props: {
      tags: { type: Array, default: () => NODE_TAGS },
      current: { type: String, default: "" },
    },
    emits: ["pick"],
    template: `
      <div class="icn__tagmenu nodrag nopan" data-node-tag
           @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
        <button v-for="tg in tags" :key="tg.name" type="button" class="icn__tagmenu-item"
                @click.stop="$emit('pick', tg.name)">
          <span class="icn__tagmenu-dot" :style="{ background: tg.color }"></span>
          <span class="icn__tagmenu-name">{{ $t(tg.name) }}</span>
          <IcIcon v-if="current === tg.name" name="check" :size="13" />
        </button>
        <button v-if="current" type="button" class="icn__tagmenu-clear" @click.stop="$emit('pick', '')">
          {{ $t('core.clearTag') }}
        </button>
      </div>`,
  };

  export const MediaSlots = {
    name: "MediaSlots",
    components: { IcIcon },
    props: { slots: { type: Array, default: () => [] } },
    setup(props) {
      const previewKey = ref(null);
      const duration = ref("0:00");
      const enter = (slot) => {
        if (!slot || !slot.asset) return;
        previewKey.value = slot.key;
        duration.value = "0:00";
      };
      const leave = () => { previewKey.value = null; };
      const meta = (event) => { duration.value = fmtTime(event && event.target && event.target.duration); };
      /* Empty slot title doubles as the hint: it names the kind the mode needs. */
      const title = (slot) => {
        if (slot.asset) return slot.asset.name;
        return t(KIND_CN[slot.kind] ? KIND_CN[slot.kind].label : "wire.asset") + " " + t("wire.slotsWireMatchingAssetNodes");
      };
      return { previewKey, duration, enter, leave, meta, title, videoThumbs };
    },
    template: `
      <div v-if="slots.length" class="icn__gpv-assets">
        <template v-for="slot in slots" :key="slot.key">
          <div class="icn__gpv-slot" @mouseenter="enter(slot)" @mouseleave="leave">
            <div class="icn__gpv-asset" :class="{ 'icn__gpv-asset--empty': !slot.asset }"
                 v-tip="title(slot)">
              <img v-if="slot.asset && slot.kind === 'image' && slot.asset.url" :src="slot.asset.url" alt="" draggable="false" />
              <template v-else-if="slot.asset && slot.kind === 'video'">
                <img v-if="videoThumbs[slot.asset.url]" :src="videoThumbs[slot.asset.url]" alt="" draggable="false" />
                <IcIcon class="icn__gpv-asset-play" name="play" :size="18" />
              </template>
              <IcIcon v-else-if="slot.asset" :name="slot.kind === 'audio' ? 'volume' : 'sparkles'" :size="15" />
              <IcIcon v-else name="upload" :size="14" />
              <span v-if="slot.asset" class="icn__gpv-asset-label">{{ slot.asset.label }}</span>
            </div>
            <div v-if="slot.asset && slot.asset.url && previewKey === slot.key"
                 class="icn__gpv-preview nodrag nopan" @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
              <img v-if="slot.kind === 'image'" class="icn__gpv-preview-media" :src="slot.asset.url" alt="" draggable="false" />
              <video v-else-if="slot.kind === 'video'" class="icn__gpv-preview-media" :src="slot.asset.url"
                     autoplay loop playsinline></video>
              <template v-else-if="slot.kind === 'audio'">
                <audio class="icn__gpv-preview-audio-hidden" :src="slot.asset.url"
                       autoplay @loadedmetadata="meta"></audio>
                <div class="icn__gpv-preview-audio-meta">
                  <span class="icn__gpv-preview-audio-name">{{ slot.asset.label }}</span>
                  <span class="icn__gpv-preview-audio-time">{{ duration }}</span>
                </div>
              </template>
              <div v-if="slot.kind === 'image' || slot.kind === 'video'" class="icn__gpv-preview-name">{{ slot.asset.label }}</div>
            </div>
          </div>
        </template>
      </div>`,
  };

