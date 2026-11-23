/* IcNode template: the single Vue template string shared by every infinite-canvas node.
   Extracted verbatim from flow-node-view.js (P3 finite split, 2026-11-22). The only JS interpolation is
   genBarHtml(), imported here directly; there is no closure state. */
import { genBarHtml } from "./flow-gen-bar.js";

export const icNodeTemplate = `    <div class="icn" :class="['icn--' + data.role, { 'is-selected': selected, 'is-running': isRunningFrame, 'is-waiting': isWaiting, 'is-error': isError, 'is-muted': !!data.muted, 'is-ignored': !!data.ignored }]" :style="rootStyle"
         :data-cleanup="isCleanup ? data.cleanupMode : null"
         @dblclick.stop="isPill ? null : startEdit" @contextmenu="openNodeMenu">
      <div class="icn__head" :class="{ 'is-generating': isProgressing && data.status === 'running' }">
        <div v-if="isProgressing && data.status === 'running'" class="icn__head-progress"
             :style="{ width: Math.round((data.genProgress || 0) * 100) + '%' }"></div>
        <span v-if="renaming" :ref="setNameBox" class="icn__name icn__name--edit nodrag"
              contenteditable="true" spellcheck="false"
              @keydown="onNameKey" @paste="onNamePaste" @blur="commitRename"
              @dblclick.stop @pointerdown.stop @mousedown.stop></span>
        <span v-else class="icn__name" @dblclick.stop="startRename"
        >{{ displayTitle }}</span>
        <span v-if="data.muted || data.ignored" class="icn__status-flag nodrag nopan"
              :class="{ 'is-muted': !!data.muted, 'is-ignored': !!data.ignored }"
              v-tip="data.muted ? $t('core.mutedDisabled') : $t('core.bypassedPassThrough')">
          <IcIcon :name="data.muted ? 'mute' : 'eye-off'" :size="13" />
        </span>
        <span class="icn__tag" data-node-tag>
          <button v-if="!tagInfo" class="icn__tag-add nodrag nopan" type="button"
                  v-tip="$t('core.addTag')" @click.stop="toggleTag">
            <IcIcon name="tag" :size="13" />
          </button>
          <button v-else class="icn__tag-chip nodrag nopan" type="button"
                  :style="{ background: tagInfo.color }" v-tip="$t('core.changeTag')"
                  @click.stop="toggleTag"><span class="icn__tag-chip-dot"></span><span class="icn__tag-chip-name">{{ $t(tagInfo.name) }}</span></button>
        </span>
      </div>
      <!-- Tag palette hangs off the node root: the header clips overflow, so
           the menu must be a sibling of .icn__head, not its child. -->
      <TagMenu v-if="tagOpen" :current="data.tag || ''" @pick="pickTag" />
      <div class="icn__body" :style="{ height: bodyH + 'px' }">
        <!-- Live generation progress (native ComfyUI WebSocket events, routed
             by prompt_id in core.js genProgress). The HEADER band carries the
             full-width progress fill (.icn__head-progress); the body shows the
             live sample preview (b_preview) with one text row floating on a
             bottom shade — step + phase left, percentage right. No sample yet:
             the body collapses to just that row (see bodyH / onGenPreviewLoad). -->
        <!-- Draggable like the rest of the node body: this card fills the whole
             body while generating, so keeping nodrag / pointerdown.stop here
             made the entire node un-draggable during generation. nopan stays
             (must not pan the canvas); dblclick.stop stays (no rename).
             The card has no interactive controls, so dragging is unambiguous.
             isProgressing (not isGen) so text generators get progress too. -->
        <div v-if="isProgressing && data.status === 'running'" class="icn__genprogress nopan"
             @dblclick.stop>
          <img v-if="data.genPreviewUrl" class="icn__gp-preview" :src="data.genPreviewUrl"
               alt="" draggable="false" @load="onGenPreviewLoad" />
          <div v-if="data.genPreviewUrl" class="icn__gp-shade"></div>
          <div class="icn__gp-row">
            <span class="icn__gp-total">{{ $t('core.all') }}:
              <b>{{ Math.round((data.genTotalProgress || 0) * 100) }}%</b></span>
            <span class="icn__gp-current">
              <span>{{ $t('core.currentNodeLabel') }}:</span>
              <span class="icn__gp-curname">{{ data.genCurrentNodeName || data.genPhaseText || $t('core.generating') }}</span>
              <b>{{ Math.round((data.genCurrentNodeProgress || 0) * 100) }}%</b>
            </span>
          </div>
        </div>
        <!-- LoRA stack: a config-only card. Each row = name combobox /
             weight stepper / enable toggle / remove. The panel is a normal
             part of the node and drags it; only the real controls opt out
             with nodrag so pressing them never moves the node. Wheel is
             deliberately NOT stopped here (or on any child): Vue Flow's zoom
             handler lives on the canvas ancestor, so the wheel must bubble
             through to let this node zoom like every other one. Only the
             floating option menu stops the wheel, since that list scrolls
             itself. -->
        <div v-if="isLora" class="icn__lora nopan" @dblclick.stop>
          <div class="icn__lora-head">
            <span class="icn__lora-head-hint">{{ $t('core.enabledLorasStackOrder') }}</span>
            <button class="icn__lora-refresh nodrag" type="button" v-tip="$t('panel.refreshLoraList')" @click.stop="loadLoraOptions">
              <IcIcon name="refresh-cw" :size="13" />
            </button>
          </div>
          <div class="icn__lora-list">
            <div v-for="(lora, i) in loras" :key="i" class="icn__lora-row" :class="{ 'is-off': lora.enabled === false }">
              <!-- Switch: verbatim WidgetToggleSwitch.vue from the 画布 API 参数面板 -->
              <button class="nodrag group inline-flex h-6 w-10 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none transition-shadow focus-visible:ring-1 focus-visible:ring-ring"
                      type="button" role="switch"
                      :data-state="lora.enabled !== false ? 'checked' : 'unchecked'"
                      v-tip="lora.enabled === false ? $t('core.enableLora') : $t('core.disableLora')"
                      @click.stop="toggleLora(i)">
                <span class="pointer-events-none inline-flex h-5 w-9 items-center rounded-full border border-transparent bg-border px-0.5 transition-colors group-data-[state=checked]:bg-primary">
                  <span class="pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0"></span>
                </span>
              </button>
              <!-- WidgetSelectDefault combobox: verbatim from the API 参数面板
                   (outer focus-within:ring wrapper included), plus data-lora-sel
                   so the search popover anchors to it. -->
              <div class="relative min-w-0 flex-1">
                <div class="nodrag min-w-0 cursor-default rounded-md transition-all focus-within:ring focus-within:ring-ring"
                     @pointerdown.stop @pointermove.stop @pointerup.stop>
                  <div class="flex w-full min-w-0 items-center overflow-hidden rounded-md bg-input text-foreground h-6 hover:bg-accent">
                    <button type="button" role="combobox" data-lora-sel
                            class="flex min-w-0 flex-1 cursor-pointer items-center overflow-hidden border-none bg-transparent p-0 outline-none"
                            v-tip="lora.name || $t('core.selectLora')"
                            @click.stop="toggleLoraSel(i, $event)">
                      <span class="min-w-[4ch] flex-1 truncate pr-1 pl-2 text-left text-xs">{{ lora.name || $t('core.selectLora') }}</span>
                    </button>
                    <button type="button" tabindex="-1" data-lora-sel
                            class="flex h-full w-6 shrink-0 cursor-pointer items-center justify-center border-none bg-transparent outline-none"
                            @click.stop="toggleLoraSel(i, $event)">
                      <IcIcon name="chevron-down" class="size-4 text-muted-foreground" />
                    </button>
                  </div>
                </div>
              </div>
              <!-- ScrubableNumberInput: verbatim from the API 参数面板 (value
                   left-aligned, aspect-square ± buttons, focus-within:ring
                   wrapper). No progress fill — a LoRA weight is a plain number. -->
              <div class="relative shrink-0" style="width:100px">
                <div class="nodrag min-w-0 cursor-default rounded-md transition-all focus-within:ring focus-within:ring-ring"
                     @pointerdown.stop @mousedown.stop @dblclick.stop>
                  <div class="relative flex w-full items-stretch overflow-hidden rounded-md bg-input text-xs text-foreground h-6">
                    <button type="button" v-tip="$t('core.decreaseWeight')"
                            class="relative flex shrink-0 cursor-pointer items-center justify-center border-none aspect-square h-full rounded-none bg-transparent p-0 text-muted-foreground hover:bg-accent"
                            @click.stop="stepLora(i, -0.01)"><IcIcon name="minus" class="size-4" /></button>
                    <div class="relative my-0.25 min-w-[4ch] flex-1 py-1.5">
                      <input class="absolute inset-0 truncate border-0 bg-transparent p-1 text-left text-xs focus:outline-0"
                             type="text" inputmode="decimal" :value="loraStrengthText(lora.strength)"
                             v-tip="$t('core.weight')" @change.stop="setLoraStrength(i, $event.target.value)"
                             @keydown.enter.stop="$event.target.blur()" />
                    </div>
                    <button type="button" v-tip="$t('core.increaseWeight')"
                            class="relative flex shrink-0 cursor-pointer items-center justify-center border-none aspect-square h-full rounded-none bg-transparent p-0 text-muted-foreground hover:bg-accent"
                            @click.stop="stepLora(i, 0.01)"><IcIcon name="plus" class="size-4" /></button>
                  </div>
                </div>
              </div>
              <button class="nodrag flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-input text-muted-foreground hover:bg-accent hover:text-red-400"
                      type="button" v-tip="$t('core.removeLora')" @click.stop="removeLora(i)">
                <IcIcon name="trash-2" class="size-4" />
              </button>
            </div>
            <div v-if="!loras.length" class="icn__lora-empty">{{ $t('core.noLoraAddedYet') }}</div>
          </div>
          <!-- Trigger words (trainedWords) of every ENABLED row, in stack
               order, read from the <stem>.metadata.json sidecar beside the
               weights. Read-only on purpose: it shows what the stack would
               inject, and the card grows with the wrapped text. The measured
               element is the WRAPPER so the label height counts too. -->
          <div v-if="enabledTriggers" :ref="setTriggerEl" class="icn__lora-triggers-wrap nopan">
            <div class="icn__lora-triggers-label">{{ $t('core.triggerWords') }}</div>
            <div class="icn__lora-triggers">{{ enabledTriggers }}</div>
          </div>
          <button class="icn__lora-add nodrag" type="button" @click.stop="addLora()">
            <IcIcon name="plus" :size="13" /><span>{{ $t('core.addLora') }}</span>
          </button>
        </div>
        <img v-else-if="hasMedia && displayKind === 'image'" class="icn__media" :src="url" alt="" draggable="false"
             @load="onImageLoad" />
        <video
          v-else-if="hasMedia && displayKind === 'video'"
          :ref="media.el" class="icn__media" :src="url" preload="metadata" playsinline
          @loadedmetadata="onVideoMeta"
        ></video>
        <template v-else-if="hasMedia && displayKind === 'audio'">
          <audio :ref="media.el" class="icn__wave-audio" :src="url" preload="metadata"></audio>
          <div class="icn__wave-host" :ref="wave.host"
               @pointerdown="wave.onDown($event)" @mousedown="wave.onMouseDown($event)"
               @pointermove="wave.onMove($event)" @pointerup="wave.onUp($event)"
               @pointercancel="wave.onUp($event)" @pointerleave="wave.onLeave($event)">
            <canvas :ref="wave.canvas" class="icn__wave"></canvas>
          </div>
        </template>
        <template v-else-if="showTextBody">
          <textarea v-if="editing" :ref="setEditor" v-model="draft"
                    class="icn__text-edit nodrag nopan" spellcheck="false"
                    @dblclick.stop @blur="commitEdit" @keydown="onEditKey"
                    @pointerdown.stop @mousedown.stop @wheel.stop></textarea>
          <div v-else class="icn__text" @dblclick.stop="startEdit" v-html="textHtml"></div>
          <button v-if="!editing && hasDisplayText" type="button"
                  class="icn__text-copy nodrag nopan" v-tip="$t('media.copyPlainText')"
                  :aria-label="$t('media.copyPlainText')"
                  @pointerdown.stop @mousedown.stop @dblclick.stop @click.stop="copyText">
            <IcIcon name="copy" :size="14" />
          </button>
          <div v-if="!editing && !hasDisplayText" class="icn__gen-empty icn__gen-empty--ghost">
            <IcIcon :name="emptyIcon" :size="emptyIconSize" />
          </div>
        </template>
        <!-- Generate nodes never upload from the body: until they have a
             result they show only the glyph of their medium. Feeding one from
             the disk is the hover-row upload action (visible only while the
             input is free). -->
        <div v-else-if="isGen" v-show="data.status !== 'running'" class="icn__gen-empty">
          <IcIcon :name="emptyIcon" :size="emptyIconSize" />
        </div>
        <button v-else class="icn__empty" type="button" v-tip="emptyHint" @click="pickFile">
          <IcIcon name="upload" :size="22" />
          <span class="icn__empty-line">{{ emptyHint }}{{$t('core.dropFile')}}</span>
        </button>
        <input v-if="!isLora && (!isGen || canUpload)" :ref="setFileInput" class="icn__file" type="file"
               :accept="acceptAttr" @change="onPicked" />

        <div v-if="bar" class="icn__bar nodrag" :ref="media.bar">
          <div class="icn__bar-left">
            <button class="icn__btn icn__btn--play" type="button" @click="media.toggle()" v-tip="media.playing.value ? $t('core.pause') : $t('core.play')" :aria-label="media.playing.value ? $t('core.pause') : $t('core.play')">
              <IcIcon :name="media.playing.value ? 'pause' : 'play'" :size="18" />
            </button>
            <span class="icn__time">
              <b>{{ media.timeText.value }}</b><i>/</i><b>{{ media.durationText.value }}</b>
            </span>
          </div>
          <div class="icn__slider icn__seek nodrag" tabindex="0" role="slider" :aria-label="$t('core.progress')"
               aria-valuemin="0" aria-valuemax="100">
            <span class="icn__slider-track"></span>
            <span class="icn__slider-fill"></span>
            <span class="icn__slider-thumb"></span>
          </div>
          <span class="icn__vol-group">
            <button class="icn__btn icn__btn--vol" type="button" @click="media.toggleMute()" v-tip="media.muteIcon.value === 'volume-x' ? $t('core.unmute') : $t('core.mute')" :aria-label="media.muteIcon.value === 'volume-x' ? $t('core.unmute') : $t('core.mute')">
              <IcIcon :name="media.muteIcon.value" :size="17" />
            </button>
            <div class="icn__slider icn__vol nodrag" tabindex="0" role="slider" :aria-label="$t('core.volume')"
                 aria-valuemin="0" aria-valuemax="100">
              <span class="icn__slider-track"></span>
              <span class="icn__slider-fill"></span>
              <span class="icn__slider-thumb"></span>
            </div>
          </span>
        </div>
      </div>

      <!-- Generate node: the body above is IDENTICAL to an asset node (media
           fills the frame, upload placeholder, corner grips, ports). Only when
           the node is selected does this full parameter PANEL appear BELOW the
           body — mirroring the reference video-generator node: a tab row, a
           prompt input area, and a compact bottom parameter bar with a round
           send button. It lives outside .icn__body so overflow:hidden can't
           clip it. -->
      <!-- VIDEO generator: reference layout (modes / wired assets / prompt /
           bottom bar with workflow + params + run). Other generators keep
           the compact panel below. Lives outside .icn__body so it isn't clipped. -->
      <div v-if="isGenVideo" class="icn__genpanel icn__gpv nodrag nopan" @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
        <!-- 一级分类（视频 / 视频工具）：只在本节点有多于一组时显示。 -->
        <div v-if="topGroups.length > 1" class="icn__gpv-tops">
          <button v-for="g in topGroups" :key="g" class="icn__gpv-top"
                  :class="{ 'is-on': topTab === g, 'is-disabled': !topGroupAvailable(g) }"
                  v-tip="topGroupReason(g) || ($t('core.switch') + $t(g))" type="button"
                  @click.stop="setTopTab(g)">{{ $t(g) }}</button>
        </div>
        <div class="icn__gpv-modes">
          <button v-for="m in topModes" :key="m" class="icn__gpv-mode"
                  :class="{ 'is-on': videoMode === m, 'is-disabled': !modeAvailable(m) }"
                  v-tip="modeReason(m) || ($t('core.switch') + $t(m))" type="button"
                  @click.stop="setVideoMode(m)">{{ $cat(m) }}</button>
        </div>
        <!-- Wired assets: shared row (shared with the image & audio panels). -->
        <MediaSlots :slots="assetSlots" />
        <label v-if="promptTextFields.length" class="icn__gpv-label">{{ textAreaLabel(promptTextFields[0], 0) }}<span v-if="boxWiredAt(0)" class="icn__gpa-wired" v-tip="wiredTextAt(0)"> · {{$t('core.textNodeConnected')}}</span></label>
        <div class="icn__gpv-input">
          <!-- "@" picker: floats above the prompt box so it never fights the
               bottom parameter bar. mousedown is prevented on purpose — the
               textarea must keep focus while a suggestion is clicked. -->
          <div v-if="mention" class="icn__gpv-atmenu"
               @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
            <button v-for="(item, i) in mention.items" :key="item.key" type="button"
                    class="icn__gpv-atitem" :class="{ 'is-on': i === mention.index }"
                    @mouseenter="hoverMention(i)" @mousedown.prevent @click.stop="pickMention(item)">
              <span class="icn__gpv-atthumb">
                <img v-if="item.thumb" :src="item.thumb" alt="" draggable="false" />
                <IcIcon v-else :name="item.kind === 'audio' ? 'volume' : 'play'" :size="12" />
              </span>
              <span class="icn__gpv-atlabel">@{{ item.label }}</span>
              <span class="icn__gpv-atname">{{ item.name }}</span>
            </button>
          </div>
          <div ref="promptEl" class="icn__gpv-rich" :contenteditable="!boxDisabledAt(0)"
               :class="{ 'is-wired': !!boxWiredAt(0), 'is-disabled': boxDisabledAt(0) }" spellcheck="false"
               :data-placeholder="wiredTextAt(0) || (noTextWorkflow ? $t('core.noWorkflowConnectedNoText') : $t('core.describeWhatWantGenerateAdjust'))"
               @input="onPromptInput" @keydown="onPromptKeydown" @blur="closeMention"
               @compositionstart="onComposeStart" @compositionend="onComposeEnd"
               @paste.prevent="onPromptPaste"
               @mouseover="onRefOver" @mouseout="onRefOut" @mouseleave="onRefOut"
               @pointerdown.stop @mousedown.stop @dblclick.stop></div>
          <!-- hover card for an inserted reference chip: exactly the slot
               thumbnail preview (same box, same media, same name strip),
               teleported into the canvas root because the panel is a
               transformed + clipped ancestor. -->
          <Teleport to="#infcanvas-root">
            <div v-if="refPreview" class="icn__gpv-preview icn__gpv-refprev"
                 :style="{ left: refPreview.left + 'px', top: refPreview.top + 'px' }"
                 @pointerdown.stop @mousedown.stop @wheel.stop>
              <img v-if="refPreview.kind === 'image' && refPreview.url"
                   class="icn__gpv-preview-media" :src="refPreview.url" alt="" draggable="false" />
              <video v-else-if="refPreview.kind === 'video' && refPreview.url"
                     class="icn__gpv-preview-media" :src="refPreview.url" autoplay loop playsinline></video>
              <template v-else-if="refPreview.kind === 'audio' && refPreview.url">
                <audio class="icn__gpv-preview-audio-hidden" :src="refPreview.url"
                       autoplay @loadedmetadata="onRefMeta"></audio>
                <div class="icn__gpv-preview-audio-meta">
                  <span class="icn__gpv-preview-audio-name">{{ refPreview.label }}</span>
                  <span class="icn__gpv-preview-audio-time">{{ refMetaDuration }}</span>
                </div>
              </template>
              <!-- media not reachable yet (thumb pending / asset removed) -->
              <img v-else-if="refPreview.thumb"
                   class="icn__gpv-preview-media" :src="refPreview.thumb" alt="" draggable="false" />
              <div v-else class="icn__gpv-preview-media icn__gpv-refprev-ph">{{ refPreview.label }}</div>
              <div v-if="refPreview.kind !== 'audio'" class="icn__gpv-preview-name">{{ refPreview.label }}</div>
            </div>
          </Teleport>
        </div>
        <!-- Any further exposed multiline-text fields get their own box,
             in the workflow's own order, right under the rich editor. -->
        <div v-if="promptTextFields.length > 1" class="icn__gpv-extras">
          <label v-for="(field, i) in promptTextFields.slice(1)" :key="fieldId(field)" class="icn__gpa-box">
            <span class="icn__gpa-label">{{ textAreaLabel(field, i + 1) }}<span v-if="boxWiredAt(i + 1)" class="icn__gpa-wired" v-tip="wiredTextAt(i + 1)"> · {{$t('core.textNodeConnected')}}</span></span>
            <textarea class="icn__gpa-area icn__gpa-area--b" :value="boxWiredAt(i + 1) ? wiredTextAt(i + 1) : textAreaValue(field, i + 1)"
                      :disabled="boxDisabledAt(i + 1)"
                      :class="{ 'is-wired': !!boxWiredAt(i + 1) }"
                      :placeholder="boxWiredAt(i + 1) ? wiredTextAt(i + 1) : $t('core.enterContent')" spellcheck="false"
                      @input="setTextArea(field, i + 1, $event.target.value)"
                      @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop></textarea>
          </label>
        </div>
        ${genBarHtml({ barClass: "icn__gpv-bar", wfTip: "$t('shortcuts.group.workflow')", sendClass: "icn__gpv-send" })}
      </div>

      <!-- AUDIO / TEXT generator: modes on top, prompt area(s), then the bottom
           bar — API selector on the LEFT, exposed API fields on the RIGHT. Both
           share this panel; only the mode row and the input areas differ. -->
      <div v-else-if="isGenAudio || isGenText" class="icn__genpanel icn__gpa nodrag nopan"
           @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
        <!-- 一级分类：音频节点有 音乐/音频 两组；文本节点只有 LLM 一组，不渲染。 -->
        <div v-if="topGroups.length > 1" class="icn__gpv-tops">
          <button v-for="g in topGroups" :key="g" class="icn__gpv-top"
                  :class="{ 'is-on': topTab === g, 'is-disabled': !topGroupAvailable(g) }"
                  v-tip="topGroupReason(g) || ($t('core.switch') + $t(g))" type="button"
                  @click.stop="setTopTab(g)">{{ $t(g) }}</button>
        </div>
        <div class="icn__gpv-modes">
          <button v-for="m in topModes" :key="m" class="icn__gpv-mode"
                  :class="{ 'is-on': isGenText ? textMode === m : audioMode === m,
                            'is-disabled': isGenText ? !textModeAvailable(m) : !audioModeAvailable(m) }"
                  v-tip="isGenText ? (textModeReason(m) || ($t('core.switch') + $t(m)))
                    : (audioModeReason(m) || ($t('core.switch') + $t(m)))"
                  type="button" @click.stop="isGenText ? setTextMode(m) : setAudioMode(m)">{{ $cat(m) }}</button>
        </div>
        <!-- Wired assets (音频 only: 音乐翻唱 / 语音克隆 wait for one clip; the
             pure-prompt modes render nothing). Same row as the other two. -->
        <MediaSlots :slots="assetSlots" />
        <!-- Every exposed multiline-text field, in the workflow's own order,
             gets a box here with its own name above it. The first box keeps
             the rich prompt slot (wired text / core's promptMap); audio's
             second box keeps lyrics; the rest bind by field id. -->
        <div v-if="isGenText" class="icn__gpa-inputs">
          <label v-for="(field, i) in promptTextFields" :key="fieldId(field)" class="icn__gpa-box">
            <span class="icn__gpa-label">{{ textAreaLabel(field, i) }}
              <span v-if="boxWiredAt(i)" class="icn__gpa-wired" v-tip="wiredTextAt(i)">· {{$t('core.textNodeConnected')}}</span>
            </span>
            <textarea class="icn__gpa-area" :class="[i === 0 ? 'icn__gpa-area--a' : 'icn__gpa-area--b', { 'is-wired': !!boxWiredAt(i) }]"
                      :value="boxWiredAt(i) ? wiredTextAt(i) : textAreaValue(field, i)"
                      :disabled="boxDisabledAt(i)"
                      :placeholder="boxWiredAt(i) ? wiredTextAt(i) : (i === 0 ? (textMode === 'cat.speechToText'
                        ? $t('core.transcriptionHintsHint')
                        : $t('core.describeWhatWantGenerate')) : $t('core.enterContent'))" spellcheck="false"
                      @input="setTextArea(field, i, $event.target.value)"
                      @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop></textarea>
          </label>
          <label v-if="!promptTextFields.length" class="icn__gpa-box">
            <span class="icn__gpa-label">{{$t('core.textInputLabel')}}</span>
            <textarea class="icn__gpa-area icn__gpa-area--a" disabled
                      :placeholder="noWorkflow ? $t('core.noWorkflowConnected') : $t('core.workflowHasNoTextInput')" spellcheck="false"></textarea>
          </label>
        </div>
        <div v-else class="icn__gpa-inputs">
          <label v-for="(field, i) in promptTextFields" :key="fieldId(field)" class="icn__gpa-box">
            <span class="icn__gpa-label">{{ textAreaLabel(field, i) }}
              <span v-if="boxWiredAt(i)" class="icn__gpa-wired" v-tip="wiredTextAt(i)">· {{$t('core.textNodeConnected')}}</span>
            </span>
            <textarea class="icn__gpa-area" :class="[i === 0 ? 'icn__gpa-area--a' : 'icn__gpa-area--b', { 'is-wired': !!boxWiredAt(i) }]"
                      :value="boxWiredAt(i) ? wiredTextAt(i) : textAreaValue(field, i)"
                      :disabled="boxDisabledAt(i)"
                      :placeholder="boxWiredAt(i) ? wiredTextAt(i)
                        : (i === 0 ? $t(audioSlots.a.ph) : (i === 1 && isGenAudio ? $t(audioSlots.b.ph) : $t('core.enterContent')))"
                      spellcheck="false"
                      @input="setTextArea(field, i, $event.target.value)"
                      @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop></textarea>
          </label>
          <label v-if="!promptTextFields.length" class="icn__gpa-box">
            <span class="icn__gpa-label">{{$t('core.textInputLabel')}}</span>
            <textarea class="icn__gpa-area icn__gpa-area--a" disabled
                      :placeholder="noWorkflow ? $t('core.noWorkflowConnected') : $t('core.workflowHasNoTextInput')" spellcheck="false"></textarea>
          </label>
        </div>
        ${genBarHtml({ barClass: "icn__gpa-bar", wfTip: "$t('core.apiWorkflow') + wfLabel", sendClass: "icn__gp-send icn__gpa-send" })}
      </div>

      <div v-else-if="isGen" class="icn__genpanel nodrag nopan" @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
        <!-- 图片生成器一级分类：图像 / 图像工具。 -->
        <div v-if="topGroups.length > 1" class="icn__gpv-tops">
          <button v-for="g in topGroups" :key="g" class="icn__gpv-top"
                  :class="{ 'is-on': topTab === g, 'is-disabled': !topGroupAvailable(g) }"
                  v-tip="topGroupReason(g) || ($t('core.switch') + $t(g))" type="button"
                  @click.stop="setTopTab(g)">{{ $t(g) }}</button>
        </div>
        <!-- The universal generator has no medium/mode vocabulary — it runs
             whatever workflow is picked, so it shows no mode tabs at all. -->
        <div v-if="!isGenOmni" class="icn__gpv-modes">
          <button v-for="m in topModes" :key="m" class="icn__gpv-mode"
                  :class="{ 'is-on': imageMode === m, 'is-disabled': !imageModeAvailable(m) }"
                  v-tip="imageModeReason(m) || ($t('core.switch') + $t(m))" type="button"
                  @click.stop="setImageMode(m)">{{ $cat(m) }}</button>
        </div>
        <!-- Wired assets: the SAME row the video generator uses, so a node in
             图像编辑 / 图像放大 / 背景移除 shows WHICH image is feeding it
             instead of leaving the user to read the wire on the canvas. -->
        <MediaSlots :slots="assetSlots" />
        <label v-if="promptTextFields.length" class="icn__gpv-label">{{ textAreaLabel(promptTextFields[0], 0) }}<span v-if="boxWiredAt(0)" class="icn__gpa-wired" v-tip="wiredTextAt(0)"> · {{$t('core.textNodeConnected')}}</span></label>
        <div class="icn__gpv-input">
          <!-- "@" picker + rich prompt box: identical to the video generator
               (same markup, same handlers, same chip hover card). -->
          <div v-if="mention" class="icn__gpv-atmenu"
               @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
            <button v-for="(item, i) in mention.items" :key="item.key" type="button"
                    class="icn__gpv-atitem" :class="{ 'is-on': i === mention.index }"
                    @mouseenter="hoverMention(i)" @mousedown.prevent @click.stop="pickMention(item)">
              <span class="icn__gpv-atthumb">
                <img v-if="item.thumb" :src="item.thumb" alt="" draggable="false" />
                <IcIcon v-else :name="item.kind === 'audio' ? 'volume' : 'play'" :size="12" />
              </span>
              <span class="icn__gpv-atlabel">@{{ item.label }}</span>
              <span class="icn__gpv-atname">{{ item.name }}</span>
            </button>
          </div>
          <div ref="promptEl" class="icn__gpv-rich" :contenteditable="!boxDisabledAt(0)"
               :class="{ 'is-wired': !!boxWiredAt(0), 'is-disabled': boxDisabledAt(0) }" spellcheck="false"
               :data-placeholder="wiredTextAt(0) || (noTextWorkflow ? $t('core.noWorkflowConnectedNoText') : $t('core.describeWhatWantGenerateAdjust'))"
               @input="onPromptInput" @keydown="onPromptKeydown" @blur="closeMention"
               @compositionstart="onComposeStart" @compositionend="onComposeEnd"
               @paste.prevent="onPromptPaste"
               @mouseover="onRefOver" @mouseout="onRefOut" @mouseleave="onRefOut"
               @pointerdown.stop @mousedown.stop @dblclick.stop></div>
          <Teleport to="#infcanvas-root">
            <div v-if="refPreview" class="icn__gpv-preview icn__gpv-refprev"
                 :style="{ left: refPreview.left + 'px', top: refPreview.top + 'px' }"
                 @pointerdown.stop @mousedown.stop @wheel.stop>
              <img v-if="refPreview.kind === 'image' && refPreview.url"
                   class="icn__gpv-preview-media" :src="refPreview.url" alt="" draggable="false" />
              <video v-else-if="refPreview.kind === 'video' && refPreview.url"
                     class="icn__gpv-preview-media" :src="refPreview.url" autoplay loop playsinline></video>
              <template v-else-if="refPreview.kind === 'audio' && refPreview.url">
                <audio class="icn__gpv-preview-audio-hidden" :src="refPreview.url"
                       autoplay @loadedmetadata="onRefMeta"></audio>
                <div class="icn__gpv-preview-audio-meta">
                  <span class="icn__gpv-preview-audio-name">{{ refPreview.label }}</span>
                  <span class="icn__gpv-preview-audio-time">{{ refMetaDuration }}</span>
                </div>
              </template>
              <img v-else-if="refPreview.thumb"
                   class="icn__gpv-preview-media" :src="refPreview.thumb" alt="" draggable="false" />
              <div v-else class="icn__gpv-preview-media icn__gpv-refprev-ph">{{ refPreview.label }}</div>
              <div v-if="refPreview.kind !== 'audio'" class="icn__gpv-preview-name">{{ refPreview.label }}</div>
            </div>
          </Teleport>
        </div>
        <!-- Any further exposed multiline-text fields get their own box,
             in the workflow's own order, right under the rich editor. -->
        <div v-if="promptTextFields.length > 1" class="icn__gpv-extras">
          <label v-for="(field, i) in promptTextFields.slice(1)" :key="fieldId(field)" class="icn__gpa-box">
            <span class="icn__gpa-label">{{ textAreaLabel(field, i + 1) }}<span v-if="boxWiredAt(i + 1)" class="icn__gpa-wired" v-tip="wiredTextAt(i + 1)"> · {{$t('core.textNodeConnected')}}</span></span>
            <textarea class="icn__gpa-area icn__gpa-area--b" :value="boxWiredAt(i + 1) ? wiredTextAt(i + 1) : textAreaValue(field, i + 1)"
                      :disabled="boxDisabledAt(i + 1)"
                      :class="{ 'is-wired': !!boxWiredAt(i + 1) }"
                      :placeholder="boxWiredAt(i + 1) ? wiredTextAt(i + 1) : $t('core.enterContent')" spellcheck="false"
                      @input="setTextArea(field, i + 1, $event.target.value)"
                      @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop></textarea>
          </label>
        </div>
        ${genBarHtml({ barClass: "icn__gp-bar", wfTip: "$t('core.apiWorkflow') + wfLabel", sendClass: "icn__gp-send" })}
      </div>

      <!-- WidgetSelectDefault's listbox lives INSIDE .icn__gpa-pop (see
           genBarHtml): the generator panel already inverse-scales as a whole,
           so the list inherits it and needs no --ic-iz of its own. -->
      <!-- LoRA name picker: the API panel's SelectContent skin (icn__gpa-fsel
           + rounded-sm hover:bg-secondary rows, check mark) verbatim, with a
           search row pinned on top because hundreds of LoRAs need filtering.
           Hung off the node root like the host's own listbox (the card clips). -->
      <div v-if="isLora && loraSelIndex != null" class="icn__gpa-fsel" :style="loraSelStyle" data-lora-sel
           @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
        <div class="icn__lora-search">
          <IcIcon name="search" :size="14" />
          <input :ref="setLoraSearchEl" v-model="loraQuery" type="text"
                 class="icn__lora-searchinput" :placeholder="$t('core.searchLora')" spellcheck="false"
                 @keydown.stop @pointerdown.stop @mousedown.stop />
        </div>
        <div class="max-h-56 overflow-y-auto p-1 text-xs">
          <button v-for="name in filteredLoraOptions" :key="name" type="button"
                  class="flex h-8 w-full cursor-pointer items-center justify-between gap-3 rounded-sm border-0 bg-transparent p-2 text-left outline-none select-none hover:bg-secondary"
                  :class="loraSelName(loraSelIndex) === name && 'bg-primary/20 hover:bg-primary/20'"
                  @click.stop="pickLoraSel(name)">
            <span class="truncate">{{ name }}</span>
            <IcIcon v-if="loraSelName(loraSelIndex) === name" name="check" class="size-3.5 shrink-0" />
          </button>
          <div v-if="!filteredLoraOptions.length" class="p-2 text-xs text-muted-foreground">{{ $t('core.noMatchingLora') }}</div>
        </div>
      </div>

      <!-- ValueControlPopover now lives inside .icn__gpa-pop (see genBarHtml):
           like the field list it inherits the panel's whole-panel --ic-iz. -->
      <div class="icn__tools">
        <button v-for="action in actions" :key="action.key" class="icn__tool" type="button"
                :data-action="action.key" :class="{ 'icn__tool--danger': action.key === 'delete' }"
                v-tip="action.tip || action.label" :aria-label="action.tip || action.label"
                @pointerdown.stop @mousedown.stop @dblclick.stop @click.stop="onAction(action.key, $event)"><IcIcon v-if="action.icon" class="icn__tool-icon" :name="action.icon" :size="14" /><span>{{ action.label }}</span></button>
      </div>

      <Handle v-if="isGen" id="in" type="target" :position="'left'" :style="{ top: handleTop(0) }" />
      <Handle v-if="isText" id="text" type="target" :position="'left'" :style="{ top: handleTop(0) }" />
      <Handle v-if="isCleanup || isMerge" id="in" type="target" :position="'left'" :style="{ top: handleTop(0) }" />
      <Handle id="out" type="source" :position="'right'" :style="{ top: handleTop(0) }" />

      <div class="icn__rz icn__rz--nw nodrag" @pointerdown="onResizeDown($event, 'nw')" :class="{ 'is-active': resizing === 'nw' }"><svg viewBox="0 0 12 12"><path d="M11 1L1 11M11 6L6 11" /></svg></div>
      <div class="icn__rz icn__rz--ne nodrag" @pointerdown="onResizeDown($event, 'ne')" :class="{ 'is-active': resizing === 'ne' }"><svg viewBox="0 0 12 12"><path d="M11 1L1 11M11 6L6 11" /></svg></div>
      <div class="icn__rz icn__rz--sw nodrag" @pointerdown="onResizeDown($event, 'sw')" :class="{ 'is-active': resizing === 'sw' }"><svg viewBox="0 0 12 12"><path d="M11 1L1 11M11 6L6 11" /></svg></div>
      <div class="icn__rz icn__rz--se nodrag" @pointerdown="onResizeDown($event, 'se')" :class="{ 'is-active': resizing === 'se' }"><svg viewBox="0 0 12 12"><path d="M11 1L1 11M11 6L6 11" /></svg></div>
    </div>
`;
