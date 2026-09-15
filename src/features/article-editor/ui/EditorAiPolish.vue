<script setup lang="ts">
import type { Editor, JSONContent } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { DOMSerializer } from '@tiptap/pm/model'
import DOMPurify from 'dompurify'
import { Check, RotateCw, WandSparkles } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch, type CSSProperties } from 'vue'
import { useArticlePolishMutation } from '@/shared/api/queries/article-polish'
import { useToast } from '@/shared/composables/useToast'
import { getErrorMessage } from '@/shared/utils/error'
import { buildPolishedDocument, canApplyPolish, createPolishSnapshot, positionPolishBubble, type PolishSnapshot } from '../model/editor-polish'

const props = defineProps<{ editor: Editor | null | undefined; disabled?: boolean; articleKey?: number | string }>()
const toast = useToast()
const mutation = useArticlePolishMutation()
const bubbleId = useId()
const trigger = ref<HTMLButtonElement | null>(null)
const bubble = ref<HTMLElement | null>(null)
const scrollArea = ref<HTMLElement | null>(null)
const open = ref(false)
const loading = ref(false)
const html = ref('')
const snapshot = shallowRef<PolishSnapshot | null>(null)
const result = shallowRef<JSONContent | null>(null)
const revision = ref(0)
const geometry = ref<ReturnType<typeof positionPolishBubble> | null>(null)
let controller: AbortController | null = null
let generation = 0
let frame = 0
const disabled = computed(() => props.disabled || !props.editor || !props.editor.isEditable)
const applicable = computed(() => {
  void revision.value
  return !disabled.value && !loading.value && !!result.value && !!snapshot.value && !!props.editor
    && canApplyPolish(snapshot.value, props.editor.getJSON())
})
const bubbleStyle = computed<CSSProperties>(() => {
  const p = geometry.value
  return p ? {
    left: p.left + 'px', top: p.top + 'px', width: p.width + 'px', height: p.height + 'px',
    '--polish-origin-x': p.originX + 'px', '--polish-origin-y': p.originY + 'px', '--polish-tail-y': p.tailY + 'px',
  } : {}
})

function position() {
  if (!open.value || !trigger.value) return
  // The expanding hover label must not move the bubble or its animation origin.
  const rect = (trigger.value.querySelector('.editor-ai-trigger-icon') ?? trigger.value).getBoundingClientRect()
  if (!rect.width || !rect.height) { close(); return }
  const viewport = window.visualViewport
  geometry.value = positionPolishBubble(rect, {
    width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight,
    left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
  })
}
function queuePosition() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(position)
}
function close(restoreFocus = false) {
  open.value = false
  generation++
  controller?.abort()
  controller = null
  loading.value = false
  mutation.reset()
  if (restoreFocus) trigger.value?.focus({ preventScroll: true })
}
function afterLeave() {
  if (open.value) return
  html.value = ''
  snapshot.value = null
  result.value = null
}
function outside(event: PointerEvent) {
  const path = event.composedPath()
  if (!path.includes(bubble.value!) && !path.includes(trigger.value!)) close()
}
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  close(true)
}
async function toggle() {
  if (open.value) { close(); return }
  if (disabled.value) return
  await generate(true)
}
async function generate(focusBubble = false) {
  if (disabled.value || loading.value || !props.editor) return
  let source: PolishSnapshot
  try { source = createPolishSnapshot(props.editor.getJSON()) }
  catch (error) { toast.error(getErrorMessage(error, '正文暂时无法润色')); return }
  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal
  const requestId = ++generation
  const previousSignature = snapshot.value?.signature
  if (previousSignature !== source.signature) { html.value = ''; result.value = null }
  snapshot.value = source
  loading.value = true
  open.value = true
  position()
  await nextTick()
  if (focusBubble) bubble.value?.focus({ preventScroll: true })
  try {
    const response = await mutation.mutateAsync({ payload: { segments: source.segments }, signal })
    if (signal.aborted || requestId !== generation || !open.value || !props.editor) return
    const document = buildPolishedDocument(source, response)
    const node = props.editor.schema.nodeFromJSON(document)
    node.check()
    const holder = window.document.createElement('div')
    holder.append(DOMSerializer.fromSchema(props.editor.schema).serializeFragment(node.content))
    html.value = DOMPurify.sanitize(holder.innerHTML)
    result.value = document
    await nextTick()
    scrollArea.value?.scrollTo({ top: 0, behavior: 'instant' })
  } catch (error) {
    if (signal.aborted || requestId !== generation) return
    toast.error(getErrorMessage(error, 'AI 润色失败，请重新生成'))
    if (!result.value) close(true)
  } finally {
    if (requestId === generation) { loading.value = false; controller = null }
  }
}
function applyResult() {
  const editor = props.editor
  if (disabled.value || loading.value || !editor || !snapshot.value || !result.value) return
  if (!canApplyPolish(snapshot.value, editor.getJSON())) {
    toast.error('正文已变化，请重新生成后再应用')
    return
  }
  try {
    const document = result.value
    // One isolated undo entry, followed by the editor's ordinary update/autosave path.
    editor.schema.nodeFromJSON(document).check()
    editor.view.dispatch(closeHistory(editor.state.tr))
    if (!editor.commands.setContent(document, { emitUpdate: true, errorOnInvalidContent: true })) {
      throw new Error('润色内容无法应用，原文已保留')
    }
    editor.view.dispatch(closeHistory(editor.state.tr))
    close()
    editor.commands.focus(undefined, { scrollIntoView: false })
  } catch (error) { toast.error(getErrorMessage(error, '润色内容无法应用，原文已保留')) }
}

watch(open, (visible, _previous, onCleanup) => {
  if (!visible) return
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('keydown', escape, true)
  window.addEventListener('resize', queuePosition)
  window.addEventListener('scroll', queuePosition, true)
  window.visualViewport?.addEventListener('resize', queuePosition)
  window.visualViewport?.addEventListener('scroll', queuePosition)
  const observer = new ResizeObserver(queuePosition)
  if (trigger.value) observer.observe(trigger.value)
  onCleanup(() => {
    document.removeEventListener('pointerdown', outside, true)
    document.removeEventListener('keydown', escape, true)
    window.removeEventListener('resize', queuePosition)
    window.removeEventListener('scroll', queuePosition, true)
    window.visualViewport?.removeEventListener('resize', queuePosition)
    window.visualViewport?.removeEventListener('scroll', queuePosition)
    observer.disconnect()
    cancelAnimationFrame(frame)
  })
})
watch(() => props.editor, (editor, _previous, onCleanup) => {
  close()
  if (!editor) return
  const onUpdate = () => { revision.value++ }
  editor.on('update', onUpdate)
  onCleanup(() => editor.off('update', onUpdate))
}, { immediate: true })
watch(() => [props.articleKey, props.disabled], () => close())
onBeforeUnmount(() => { close(); cancelAnimationFrame(frame) })
</script>

<template>
  <button ref="trigger" type="button" class="editor-ai-trigger" :class="{ 'is-open': open }"
    :disabled="disabled" aria-label="AI 润色" title="AI 润色" aria-haspopup="dialog"
    :aria-expanded="open" :aria-controls="open ? bubbleId : undefined" @pointerdown.prevent @click="toggle">
    <span class="editor-ai-trigger-icon"><WandSparkles :size="16" :stroke-width="1.65" aria-hidden="true" /></span>
    <span class="editor-ai-trigger-label">AI 润色</span>
  </button>
  <Teleport to="body">
    <Transition name="editor-polish-bubble" @after-leave="afterLeave">
      <section v-if="open" :id="bubbleId" ref="bubble" class="editor-polish-bubble"
        :class="{ 'has-tail': geometry?.tailVisible, 'is-left': geometry?.side === 'left' }"
        :style="bubbleStyle" role="dialog" aria-label="AI 润色内容" :aria-busy="loading" tabindex="-1">
        <div ref="scrollArea" class="editor-polish-scroll" tabindex="0" aria-label="润色正文">
          <div v-if="html" class="editor-polish-prose prose" :class="{ 'is-regenerating': loading }" v-html="html" />
          <div v-else class="editor-polish-skeleton" aria-hidden="true"><span v-for="line in 10" :key="line" /></div>
        </div>
        <div class="editor-polish-actions">
          <button type="button" class="editor-polish-action" :disabled="loading" :aria-label="loading ? '正在润色' : '重新生成'"
            :title="loading ? '正在润色' : '重新生成'" @click="generate()">
            <RotateCw :size="18" :stroke-width="1.75" :class="{ 'is-spinning': loading }" aria-hidden="true" />
          </button>
          <button type="button" class="editor-polish-action editor-polish-action--apply" :disabled="!applicable"
            aria-label="确认应用" :title="result && !applicable && !loading ? '正文已变化，请重新生成' : '确认应用'" @click="applyResult">
            <Check :size="21" :stroke-width="1.8" aria-hidden="true" />
          </button>
        </div>
      </section>
    </Transition>
  </Teleport>
</template>

<style scoped>
.editor-ai-trigger { display:flex; align-items:center; flex-shrink:0; overflow:hidden; white-space:nowrap; border-radius:var(--radius-pill); border:1px solid var(--color-border); background:var(--color-surface-elevated); color:var(--color-text-muted); box-shadow:var(--shadow-xs); transition:color 180ms ease,background-color 180ms ease,box-shadow 180ms ease,transform 180ms ease; }
.editor-ai-trigger-icon { display:inline-flex; width:2.125rem; height:2.125rem; align-items:center; justify-content:center; flex-shrink:0; }
.editor-ai-trigger-label { max-width:0; overflow:hidden; padding-right:0; font-size:.75rem; transition:max-width 180ms ease,padding-right 180ms ease; }
.editor-ai-trigger:hover:not(:disabled),.editor-ai-trigger.is-open { color:var(--color-primary); background:color-mix(in srgb,var(--color-primary) 8%,var(--color-surface-elevated)); box-shadow:var(--shadow-xs); }
.editor-ai-trigger:not(.is-open):hover .editor-ai-trigger-label,.editor-ai-trigger:not(.is-open):focus-visible .editor-ai-trigger-label { max-width:4.75rem; padding-right:.85rem; }
.editor-ai-trigger:disabled { opacity:.45; cursor:not-allowed; }
.editor-polish-bubble { position:fixed; z-index:2600; isolation:isolate; border:1px solid var(--color-border); border-radius:var(--radius-xl); background:var(--color-surface-elevated); color:var(--color-text); box-shadow:var(--shadow-lg); transform-origin:var(--polish-origin-x) var(--polish-origin-y); outline:none; }
.editor-polish-bubble.has-tail::before { content:''; position:absolute; z-index:-1; left:-7px; top:calc(var(--polish-tail-y) - 7px); width:13px; height:13px; background:var(--color-surface-elevated); border-left:1px solid var(--color-border); border-bottom:1px solid var(--color-border); transform:rotate(45deg); }
.editor-polish-bubble.has-tail.is-left::before { left:auto; right:-7px; transform:rotate(225deg); }
.editor-polish-scroll { height:100%; overflow:auto; overscroll-behavior:contain; border-radius:inherit; padding:1.6rem 1.75rem 5.6rem; scrollbar-width:thin; scrollbar-color:var(--color-border-strong) transparent; outline:none; }
.editor-polish-scroll:focus-visible { outline:2px solid var(--color-primary); outline-offset:-4px; }
.editor-polish-prose { font-size:.98rem; line-height:1.95; overflow-wrap:anywhere; transition:opacity 180ms ease; }
.editor-polish-prose.is-regenerating { opacity:.45; }
.editor-polish-prose :deep(> :first-child) { margin-top:0; }
.editor-polish-prose :deep(h1),.editor-polish-prose :deep(h2),.editor-polish-prose :deep(h3) { font-size:1.22rem; line-height:1.5; letter-spacing:normal; }
.editor-polish-prose :deep(img) { max-width:100%; height:auto; }
.editor-polish-prose :deep(pre) { font-size:.85em; white-space:pre-wrap; }
.editor-polish-prose :deep(table) { width:100%; table-layout:fixed; }
.editor-polish-prose :deep(blockquote) { border-left-width:1px; }
.editor-polish-prose :deep(::selection) { background:color-mix(in srgb,var(--color-primary) 22%,transparent); }
.editor-polish-actions { position:absolute; z-index:2; right:1rem; bottom:1rem; display:flex; gap:.6rem; }
.editor-polish-action { display:inline-flex; align-items:center; justify-content:center; width:2.75rem; height:2.75rem; border-radius:var(--radius-pill); border:1px solid var(--color-border); background:var(--color-surface-elevated); color:var(--color-text-muted); box-shadow:var(--shadow-button); transition:transform 160ms ease,background-color 160ms ease,color 160ms ease,opacity 160ms ease; }
.editor-polish-action--apply { background:var(--color-primary); color:var(--color-surface); border-color:transparent; }
.editor-polish-action:hover:not(:disabled) { transform:translateY(-2px); }
.editor-polish-action:active:not(:disabled) { transform:scale(.94); }
.editor-polish-action:disabled { cursor:not-allowed; opacity:.42; }
.editor-polish-action:focus-visible,.editor-ai-trigger:focus-visible { outline:2px solid var(--color-primary); outline-offset:4px; }
.editor-polish-skeleton { display:flex; flex-direction:column; gap:1rem; padding:.35rem 0; }
.editor-polish-skeleton span { display:block; width:100%; height:.7rem; border-radius:var(--radius-pill); background:color-mix(in srgb,var(--color-text-muted) 12%,var(--color-surface-elevated)); }
.editor-polish-skeleton span:nth-child(4n) { width:67%; margin-bottom:1.5rem; }
.editor-polish-skeleton span:first-child { width:43%; height:1rem; margin-bottom:.65rem; }
.editor-polish-bubble-enter-active { transition:transform 380ms cubic-bezier(.16,1,.3,1),opacity 240ms ease,filter 300ms ease; }
.editor-polish-bubble-leave-active { transition:transform 220ms cubic-bezier(.4,0,.8,.3),opacity 180ms ease,filter 180ms ease; pointer-events:none; }
.editor-polish-bubble-enter-from,.editor-polish-bubble-leave-to { transform:scale(.08,.12); opacity:0; filter:blur(5px); }
.is-spinning { animation:editor-polish-spin 1s linear infinite; }
@keyframes editor-polish-spin { to { transform:rotate(360deg); } }
@media(max-width:600px) { .editor-polish-scroll { padding:1.25rem 1.25rem 5.25rem; } }
@media(prefers-reduced-motion:reduce) { .editor-polish-bubble-enter-active,.editor-polish-bubble-leave-active,.editor-ai-trigger,.editor-ai-trigger-label,.editor-polish-action,.editor-polish-prose { transition:none; } .editor-polish-bubble-enter-from,.editor-polish-bubble-leave-to { transform:none; filter:none; } .is-spinning { animation:none; } }
</style>
