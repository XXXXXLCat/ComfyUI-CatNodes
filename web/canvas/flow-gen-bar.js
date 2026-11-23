/* Shared API-parameter / workflow-picker / run bar for the three generator
   panels (video, audio/text, universal). All three used to carry the same 199
   template lines with only 3 differences: bar class, workflow tooltip, and
   send-button class. genBarHtml() emits the block with those 3 slots filled.

   This is a TEMPLATE FRAGMENT factory, not a Vue component: the emitted markup
   references setup-scoped symbols (apiBarFields, fieldId, setOpen, wfLabel,
   run, ...) already returned by IcNode.setup, so it is interpolated into
   IcNode's single template string and keeps full reactivity with zero prop
   plumbing. The fragment must contain no backtick and no ${...} other than
   the three intended slots. */

export function genBarHtml({ barClass, wfTip, sendClass }) {
  return `        <div class="${barClass}">
          <div class="icn__bar2-row icn__bar2-setrow">
          <div class="icn__gpa-setwrap">
            <button class="icn__gpa-set" :class="{ 'is-open': setOpen, 'is-disabled': noWorkflow }"
                    type="button" :disabled="noWorkflow"
                    v-tip="noWorkflow ? $t('prompt.noWorkflowsCategory')
                      : (apiBarFields.length
                      ? $t('core.apiParamsCount', { n: visibleBarFields.length })
                      : $t('core.apiParamsNoParametersExposed'))"
                    @click.stop="toggleSet($event)">
              <IcIcon name="settings" :size="14" />
              <span v-if="apiBarFields.length && !setOpen" class="icn__gpa-setdot"></span>
            </button>
            <div v-if="setOpen" class="icn__gpa-pop" :style="popStyle"
                 @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
              <div class="icn__gpa-pophead">
                <span class="icn__gpa-popt">{{$t('core.apiParams')}}</span>
                <span v-if="apiBarFields.length" class="icn__gpa-popcnt">{{ visibleBarFields.length }}</span>
              </div>
              <div v-if="!apiBarFields.length" class="icn__gpa-popempty">
                {{ $t('core.noApiParametersExposedSelect') }}
              </div>
              <!-- Nodes 2.0 WidgetGrid: the class string is WidgetGrid.vue verbatim
                   (12px slot | minmax(80px,min-content) label | minmax(125px,1fr)
                   control, 4px row gap, 12px right gutter), so every control gets
                   its width from the shared column instead of a hand-set px. -->
              <div v-else
                   class="icn__gpa-body lg-node-widgets grid grid-cols-[min-content_minmax(80px,min-content)_minmax(125px,1fr)] gap-y-1 bg-node pt-4 pr-3 pb-3 text-xs text-node-foreground rounded-b-xl">
                <div v-for="f in visibleBarFields" :key="fieldId(f)"
                     :data-widget-name="fieldId(f)"
                     class="group col-span-full grid grid-cols-subgrid items-stretch">
                  <div class="z-10 flex items-stretch w-3"></div>
                  <!-- WidgetLayoutField -->
                  <div class="col-span-2 grid min-w-0 grid-cols-subgrid justify-between gap-2">
                    <div class="content-center-safe truncate" v-tip="f.label || fieldId(f)">{{ f.label || fieldId(f) }}</div>
                    <div class="relative min-w-0 flex-1">
                      <div class="min-w-0 cursor-default rounded-lg transition-all"
                           :class="f.type !== 'switch' && 'focus-within:ring focus-within:ring-ring'"
                           @pointerdown.stop @pointermove.stop @pointerup.stop>

                        <!-- ScrubableNumberInput (WidgetInputNumberInput.vue) -->
                        <div v-if="f.type === 'number' || f.type === 'slider' || f.type === 'random'"
                             class="relative flex w-full items-stretch overflow-hidden rounded-lg bg-secondary text-xs text-foreground h-7.5 hover:bg-accent">
                          <span class="pointer-events-none absolute inset-0 overflow-clip rounded-lg">
                            <span class="block size-full bg-primary/15" :style="{ width: fieldFill(f) + '%' }"></span>
                          </span>
                          <button type="button" v-tip="$t('core.decrease')" :disabled="!canFieldDec(f)"
                                  class="relative flex shrink-0 cursor-pointer items-center justify-center border-none h-full w-6 rounded-none bg-transparent p-0 text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
                                  @click.stop="bumpField(f, -1)">
                            <IcIcon name="minus" class="size-4" />
                          </button>
                          <div class="relative my-0.25 min-w-[4ch] flex-1 py-1.5">
                            <input class="absolute inset-0 truncate border-0 bg-transparent p-1 text-left text-xs focus:outline-0"
                                   :value="fieldText(f)" inputmode="decimal"
                                   autocomplete="off" autocorrect="off" spellcheck="false"
                                   @blur="commitFieldNum(f, $event)"
                                   @keydown.enter.prevent="commitFieldNum(f, $event)"
                                   @keydown.up.prevent="stepField(f, 1)"
                                   @keydown.down.prevent="stepField(f, -1)"
                                   @keydown.page-up.prevent="stepField(f, 10)"
                                   @keydown.page-down.prevent="stepField(f, -10)"
                                   @pointerdown.stop @mousedown.stop @dblclick.stop />
                            <div class="absolute inset-0 z-10 cursor-ew-resize touch-pan-y"
                                 :class="editingField === fieldId(f) && 'pointer-events-none hidden'"
                                 @pointerdown.stop="scrubStart(f, $event)"
                                 @pointermove.stop="scrubMove($event)"
                                 @pointerup.stop="scrubEnd(f, $event)"
                                 @pointercancel="scrubCancel"
                                 @dblclick.stop></div>
                          </div>
                          <!-- ValueControlButton (WidgetWithControl slot) -->
                          <button v-if="isRandomField(f)" type="button" v-tip="modeTitle(f)"
                                  data-vc-badge="1"
                                  class="mr-1 flex h-4.5 w-8 shrink-0 cursor-pointer items-center justify-center self-center rounded-full border-none"
                                  :class="fieldMode(f) === 'fixed'
                                    ? 'bg-transparent text-muted-foreground hover:bg-accent'
                                    : 'bg-primary/30 text-primary hover:bg-primary/27'"
                                  @click.stop="openModes(f, $event)">
                            <IcIcon v-if="fieldMode(f) === 'fixed'" name="pencil-off" class="size-3" />
                            <IcIcon v-else-if="fieldMode(f) === 'randomize'" name="shuffle" class="size-3" />
                            <span v-else class="text-xs font-normal">{{ fieldMode(f) === 'increment' ? '+1' : '-1' }}</span>
                          </button>
                          <button type="button" v-tip="$t('controls.increase')" :disabled="!canFieldInc(f)"
                                  class="relative flex shrink-0 cursor-pointer items-center justify-center border-none h-full w-6 rounded-none bg-transparent p-0 text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
                                  @click.stop="bumpField(f, 1)">
                            <IcIcon name="plus" class="size-4" />
                          </button>
                        </div>

                        <!-- WidgetSelectDefault (combobox trigger) -->
                        <div v-else-if="f.type === 'select'"
                             class="flex w-full min-w-0 items-center overflow-hidden rounded-lg bg-secondary text-foreground h-7.5 hover:bg-accent">
                          <button type="button" role="combobox"
                                  class="flex min-w-0 flex-1 cursor-pointer items-center overflow-hidden border-none bg-transparent p-0 outline-none"
                                  v-tip="(f.label || '') + ' ' + $t('field.currentValue', { value: fieldValue(f) })"
                                  @click.stop="toggleSel('f:' + fieldId(f), $event)">
                            <span class="min-w-[4ch] flex-1 truncate pr-1 pl-2 text-left text-xs">{{ fieldValue(f) }}</span>
                          </button>
                          <button type="button" tabindex="-1"
                                  class="flex h-full w-6 shrink-0 cursor-pointer items-center justify-center border-none bg-transparent outline-none"
                                  @click.stop="toggleSel('f:' + fieldId(f), $event)">
                            <IcIcon name="chevron-down" class="size-4 text-muted-foreground" />
                          </button>
                        </div>

                        <!-- Switch (WidgetToggleSwitch.vue, no on/off labels) -->
                        <div v-else-if="f.type === 'switch'"
                             class="-m-1 ml-auto flex w-fit items-center gap-2 rounded-full p-1">
                          <button type="button" :data-state="fieldValue(f) ? 'checked' : 'unchecked'"
                                  class="group inline-flex h-6 w-10 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none transition-shadow focus-visible:ring-1 focus-visible:ring-ring"
                                  v-tip="(f.label || $t('field.toggle')) + $t('core.punctColon') + (fieldValue(f) ? $t('core.on') : $t('core.off'))"
                                  @click.stop="setFieldValue(f, !fieldValue(f))">
                            <span class="pointer-events-none inline-flex h-5 w-9 items-center rounded-full border border-transparent bg-border px-0.5 transition-colors group-data-[state=checked]:bg-primary">
                              <span :data-state="fieldValue(f) ? 'checked' : 'unchecked'"
                                    class="pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0"></span>
                            </span>
                          </button>
                        </div>

                        <!-- WidgetInputText -->
                        <label v-else class="relative flex w-full min-w-0 items-center">
                          <input class="flex w-full min-w-0 appearance-none rounded-lg border-none bg-secondary px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                                 :value="fieldValue(f)" spellcheck="false" autocomplete="off"
                                 v-tip="f.label || ''"
                                 @change="setFieldValue(f, $event.target.value)"
                                 @pointerdown.stop @mousedown.stop @dblclick.stop />
                        </label>

                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <!-- NodeFooter.vue Case 4, host utility classes. The band is a
                   plain 32px row (h-8 + py-0) with the label centred: upstream
                   uses h-11 with -mt-5 so only its bottom 24px shows under the
                   node body, but this card has no body to hide behind, so the
                   hidden part is dropped and the visible band is made 32px to
                   match the parameter rows above. Band colour (bg-node-header),
                   radius (rounded-b-xl) and type (text-xs font-normal) stay
                   host-native. -->
              <div v-if="advancedCount"
                   class="icn__gpa-more box-border flex w-full">
                <button type="button"
                        class="pointer-events-auto relative inline-flex box-border h-8 w-full cursor-pointer touch-manipulation appearance-none items-center justify-center gap-2 rounded-none rounded-b-xl border-none bg-node-header py-0 font-inter text-xs font-normal whitespace-nowrap text-node-foreground transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0"
                        v-tip="(data.showAdvanced ? $t('core.hideAdvancedInputs') : $t('core.showAdvancedInputs')) + $t('core.punctParenOpen') + advancedCount + ' ' + $t('core.items') + $t('core.punctParenClose')"
                        @click.stop="toggleAdvanced">
                  <div class="flex size-full items-center justify-center gap-2">
                    <span class="truncate">{{ data.showAdvanced ? $t('core.hideAdvancedInputs') : $t('core.showAdvancedInputs') }}</span>
                    <IcIcon :name="data.showAdvanced ? 'chevron-up' : 'settings-2'" :size="16" class="shrink-0" />
                  </div>
                </button>
              </div>
              <!-- WidgetSelectDefault's listbox: a popover OF this card, so it
                   lives here instead of on the node root. The generator panel
                   inverse-scales as a whole, making card CSS px 1:1 with screen
                   px — no per-menu --ic-iz and no zoom re-anchoring needed. -->
              <div v-if="selField" class="icn__gpa-fsel" :style="selStyle"
                   @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
                <div class="icn__sel-search">
                  <IcIcon name="search" :size="14" />
                  <input :ref="setSelSearchEl" v-model="selQuery" type="text"
                         class="icn__sel-searchinput" :placeholder="$t('core.searchOptions')" spellcheck="false"
                         @keydown.stop @pointerdown.stop @mousedown.stop />
                </div>
                <div class="max-h-56 overflow-y-auto p-1 text-xs">
                  <button v-for="opt in filteredSelOptions" :key="opt" type="button"
                          class="flex h-8 w-full cursor-pointer items-center justify-between gap-3 rounded-sm border-0 bg-transparent p-2 text-left outline-none select-none hover:bg-secondary"
                          :class="fieldValue(selField) === opt && 'bg-primary/20 hover:bg-primary/20'"
                          @click.stop="pickSel('f:' + fieldId(selField), opt)">
                    <span class="truncate">{{ opt }}</span>
                    <IcIcon v-if="fieldValue(selField) === opt" name="check" class="size-3.5 shrink-0" />
                  </button>
                  <div v-if="!filteredSelOptions.length" class="p-2 text-xs text-muted-foreground">{{ $t('core.noMatchingOption') }}</div>
                </div>
              </div>
              <!-- ValueControlPopover (ComfyUI): what happens to a 随机数 each
                   run. Like the field list it is a popover OF this card now. -->
              <div v-if="modeOpen" class="icn__gpa-modes" :style="modeStyle"
                   @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
                <div class="w-full space-y-2 p-2">
                  <div class="px-1 pb-0.5 text-xs/tight text-muted-foreground">{{ $t('core.autoUpdateValue') }}
                    <span class="font-medium text-foreground">{{ $t('core.after') }}</span> {{ $t('core.runningWorkflow') }}</div>
                  <div class="flex flex-col gap-0.5">
                    <div v-for="opt in CONTROL_MODES" :key="opt.mode"
                         class="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1.5 text-left">
                      <button type="button"
                              class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-wrap"
                              @click.stop="pickMode(opt.mode)">
                        <span class="flex size-6 shrink-0 items-center justify-center rounded-md border border-solid border-border/50 bg-secondary">
                          <IcIcon v-if="opt.icon" :name="opt.icon" :size="14" class="text-foreground" />
                          <span v-else class="text-xs font-normal text-foreground">{{ opt.text }}</span>
                        </span>
                        <span class="flex min-w-0 flex-1 flex-col text-xs/tight font-normal">
                          <span class="text-foreground">{{ opt.title }}</span>
                          <span class="text-muted-foreground">{{ opt.desc }}</span>
                        </span>
                      </button>
                      <button type="button"
                              class="inline-flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded-full border border-solid bg-transparent outline-none"
                              :class="modeField && fieldMode(modeField) === opt.mode ? 'border-primary' : 'border-border'"
                              @click.stop="pickMode(opt.mode)">
                        <span v-if="modeField && fieldMode(modeField) === opt.mode"
                              class="block size-1.5 rounded-full bg-primary"></span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="!noWorkflow" class="icn__bar2-params nodrag nopan" v-tip="$t('core.clickEditParameters')" @click.stop="openSetFromBar">
            <template v-for="(f, i) in plainParams" :key="fieldId(f) + '_' + i">
              <span v-if="i" class="icn__bar2-dot">·</span>
              <span class="icn__bar2-param inline-flex flex-col items-start min-w-0 whitespace-nowrap"><span class="inline-flex items-center gap-1"><b class="text-xs font-medium leading-tight text-muted-foreground">{{ paramLabel(f) }}</b><span v-if="isRandomField(f)" class="icn__bar2-mode flex h-4 w-7 shrink-0 items-center justify-center rounded-full border-none" :class="fieldMode(f) === 'fixed' ? 'bg-transparent text-muted-foreground' : 'bg-primary/30 text-primary'" v-tip="modeTitle(f)"><IcIcon v-if="fieldMode(f) === 'fixed'" name="pencil-off" class="size-3" /><IcIcon v-else-if="fieldMode(f) === 'randomize'" name="shuffle" class="size-3" /><span v-else class="text-xs font-normal">{{ fieldMode(f) === 'increment' ? '+1' : '-1' }}</span></span></span><span class="text-xs leading-snug text-foreground" v-if="paramText(f)">{{ paramText(f) }}</span></span>
            </template>
            <span v-if="!plainParams.length" class="icn__bar2-empty">{{ $t('core.noBasicParametersExposedApi') }}</span>
          </div>
          </div>
          <div class="icn__bar2-row icn__bar2-runrow">
          <div class="icn__selwrap">
            <div v-if="noWorkflow" class="icn__sel icn__sel--empty" v-tip="$t('prompt.noWorkflowsCategory')">
              <span class="icn__sel-t">{{$t('prompt.noWorkflowsCategory')}}</span>
            </div>
            <template v-else>
              <button class="icn__sel" :class="{ 'is-open': selOpen === 'wf' }" type="button"
                      v-tip="${wfTip}" @click.stop="toggleSel('wf', $event)">
                <span class="icn__sel-t">{{ wfLabel }}</span>
                <IcIcon class="icn__sel-caret" name="chevron-down" :size="14" />
              </button>
              <div v-if="selOpen === 'wf'" class="icn__selmenu icn__selmenu--search" :style="wfMenuStyle"
                   @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
                <div class="icn__sel-search">
                  <IcIcon name="search" :size="14" />
                  <input :ref="setSelSearchEl" v-model="selQuery" type="text"
                         class="icn__sel-searchinput" :placeholder="$t('core.searchWorkflows')" spellcheck="false"
                         @keydown.stop @pointerdown.stop @mousedown.stop />
                </div>
                <button v-for="w in filteredWfOptions" :key="w.id" type="button" class="icn__selitem"
                        :class="{ 'is-on': wfValue === w.id }" @click.stop="pickSel('wf', w.id)">
                  <span class="icn__selitem-t">{{ w.name || w.id }}</span>
                  <IcIcon v-if="wfValue === w.id" class="icn__selitem-check" name="check" :size="14" />
                </button>
                <div v-if="!filteredWfOptions.length" class="icn__selitem icn__selitem--hint">{{ $t('core.noMatchingWorkflow') }}</div>
              </div>
            </template>
          </div>
          <div class="icn__gp-run">
            <button v-if="data.status === 'running'" class="icn__gp-cancel" type="button"
                    v-tip="$t('core.cancelJob')" @click.stop="cancelGen">{{$t('api.cancel')}}</button>
            <button class="${sendClass}" type="button"
                    v-tip="noWorkflow ? $t('prompt.noWorkflowsCategory') : (data.status === 'running' ? (isWaiting ? $t('core.waiting') : $t('core.running')) : $t('core.runGeneration'))"
                    :disabled="data.status === 'running' || noWorkflow" @click.stop="run">{{ data.status === 'running' ? (isWaiting ? $t('core.waiting') : $t('core.running')) : $t('core.run') }}</button>
          </div>
          </div>
        </div>`;
}
