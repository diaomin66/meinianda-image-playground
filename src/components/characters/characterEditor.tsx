import { useEffect, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { ArrowUpLeft, ImagePlus, LoaderCircle, Sparkles, X } from 'lucide-react'
import type { Character } from '../../types'
import { createInputImageFromFile } from '../../store'
import { saveCharacters, useCharacterStore } from '../../characterStore'
import CharacterImage from './characterImage'

export default function CharacterEditor({
  character,
  closing,
  onClose,
  onSaved,
}: {
  character: Character | null
  closing: boolean
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [draft, setDraft] = useState<Character>(
    () =>
      character ?? {
        id: nanoid(),
        name: '',
        personality: '',
        appearance: '',
        opening: '',
        referenceImageIds: [],
        autoImages: true,
        lifeSchedulerEnabled: true,
        lifeScheduleTime: '07:00',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const avatarRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  const upload = async (files: FileList | null, avatar = false) => {
    if (!files?.length) return
    setBusy(true)
    setError('')
    try {
      const ids = [...draft.referenceImageIds]
      for (const file of Array.from(files)) {
        if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('请上传 PNG、JPG、WebP 或 GIF 图片。')
        if (file.size > 20 * 1024 * 1024) throw new Error('单张图片请控制在 20 MB 以内。')
        if (!avatar && ids.length >= 8) throw new Error('最多保存 8 张人物参考图。')
        const img = await createInputImageFromFile(file)
        if (!img) throw new Error('图片读取失败，请换一张图片重试。')
        if (avatar) {
          setDraft((value) => ({ ...value, avatarImageId: img.id }))
          break
        }
        if (!ids.includes(img.id)) ids.push(img.id)
        setDraft((value) => ({ ...value, referenceImageIds: [...ids] }))
      }
    } catch (err) {
      console.warn('人物图片上传失败', err)
      setError(err instanceof Error ? err.message : '图片上传失败，请重试。')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
      if (avatarRef.current) avatarRef.current.value = ''
    }
  }

  return (
    <dialog
      ref={dialogRef}
      data-closing={closing}
      inert={closing}
      className="character-dialog w-[min(760px,calc(100%-24px))] rounded-3xl bg-white p-0 text-gray-900 shadow-2xl backdrop:bg-gray-950/50 backdrop:backdrop-blur-sm dark:bg-gray-900 dark:text-gray-100"
      onCancel={(e) => {
        e.preventDefault()
        if (!busy && !closing) onClose()
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (!draft.name.trim() || !draft.personality.trim() || busy) return
          setBusy(true)
          setError('')
          try {
            useCharacterStore
              .getState()
              .saveCharacter({ ...draft, name: draft.name.trim(), updatedAt: Date.now() })
            await saveCharacters()
            onSaved(draft.id)
          } catch (err) {
            console.error('保存人物失败', err)
            setError('人物暂未保存到本地，请重试。')
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="flex items-start justify-between px-6 pb-2 pt-6">
          <div>
            <p className="mb-1 text-xs font-medium tracking-widest text-blue-500">人物档案</p>
            <h2 className="text-xl font-semibold">{character ? '编辑人物' : '认识一个新的人物'}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="character-icon-button" aria-label="关闭人物编辑">
            <X size={20} />
          </button>
        </div>
        <div className="grid gap-7 overflow-y-auto p-6 sm:grid-cols-[190px_1fr]" style={{ maxHeight: 'calc(85dvh - 164px)' }}>
          <div className="flex flex-col items-center self-start rounded-3xl bg-blue-50/60 p-5 text-center dark:bg-blue-500/5">
            <button
              type="button"
              disabled={busy}
              aria-label={draft.avatarImageId ? '更换人物头像' : '上传人物头像'}
              onClick={() => avatarRef.current?.click()}
              className="group relative shrink-0 rounded-full"
            >
              <CharacterImage
                id={draft.avatarImageId}
                name={draft.name}
                avatar
                className="h-24 w-24 rounded-full object-cover text-3xl sm:h-28 sm:w-28"
              />
              <span className="absolute bottom-0 right-0 rounded-full bg-blue-600 p-2 text-white shadow-sm transition group-hover:bg-blue-700">
                <ImagePlus size={15} />
              </span>
            </button>
            <p className="mt-4 max-w-full truncate text-sm font-medium">{draft.name || '人物头像'}</p>
            <button type="button" disabled={busy} onClick={() => avatarRef.current?.click()} className="mt-2 rounded-full px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-500/10">
              {draft.avatarImageId ? '更换头像' : '上传头像'}
            </button>
            {draft.avatarImageId && (
              <button type="button" disabled={busy} onClick={() => setDraft({ ...draft, avatarImageId: undefined })} className="mt-1 rounded-full px-3 py-1.5 text-xs text-gray-500 hover:bg-blue-100 dark:hover:bg-blue-500/10">
                移除头像
              </button>
            )}
            <p className="mt-4 text-xs leading-6 text-gray-500">头像独立于参考图。<br />未上传时取名字前两字。</p>
            <input ref={avatarRef} type="file" aria-label="选择人物头像" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void upload(e.target.files, true)} />
          </div>
          <div className="space-y-5">
            <label className="block text-sm font-medium">
              名字 <span className="text-blue-500">*</span>
              <input
                autoFocus
                required
                maxLength={40}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="TA 叫什么名字？"
                className="character-field mt-2"
              />
            </label>
            <label className="block text-sm font-medium">
              人格设定 <span className="text-blue-500">*</span>
              <textarea
                required
                rows={4}
                maxLength={12000}
                value={draft.personality}
                onChange={(e) => setDraft({ ...draft, personality: e.target.value })}
                placeholder="例如：独立摄影师，随和但有一点嘴硬。喜欢观察生活细节，说话简短自然，熟悉之后会开玩笑。和我是认识多年的朋友。"
                className="character-field mt-2 resize-y leading-6"
              />
              <span className="mt-2 block text-xs font-normal leading-5 text-gray-400">原文直接作为系统提示词，不附加内置角色指令。请在这里完整描述身份、性格和说话方式。</span>
            </label>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">
                  人物参考图 <span className="font-normal text-gray-400">可选</span>
                </span>
                <span className="text-xs text-gray-400">{draft.referenceImageIds.length} / 8</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {draft.referenceImageIds.map((id, idx) => (
                  <div key={id} className="group relative overflow-hidden rounded-2xl">
                    <CharacterImage id={id} name={`参考图 ${idx + 1}`} className="aspect-square w-full object-cover" />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setDraft({ ...draft, referenceImageIds: draft.referenceImageIds.filter((item) => item !== id) })}
                      aria-label={`删除参考图 ${idx + 1}`}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
                    >
                      <X size={12} />
                    </button>
                    {idx === 0 ? (
                      <span className="absolute bottom-1 left-1 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] text-white">主图</span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setDraft({ ...draft, referenceImageIds: [id, ...draft.referenceImageIds.filter((item) => item !== id)] })
                        }
                        title="设为主图"
                        aria-label={`将参考图 ${idx + 1} 设为主图`}
                        className="absolute bottom-1 left-1 rounded-full bg-black/60 p-1 text-white"
                      >
                        <ArrowUpLeft size={12} />
                      </button>
                    )}
                  </div>
                ))}
                {draft.referenceImageIds.length < 8 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                    className="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl bg-blue-50 text-blue-500 transition hover:bg-blue-100 dark:bg-blue-500/10 dark:hover:bg-blue-500/20"
                  >
                    <ImagePlus size={22} />
                    <span className="text-xs">上传图片</span>
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                aria-label="选择人物参考图"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                hidden
                onChange={(e) => void upload(e.target.files)}
              />
              <p className="mt-2 text-xs leading-5 text-gray-400">参考图用于聊天与生图，与头像分开保存。</p>
            </div>
            <details className="group rounded-2xl bg-gray-50 p-4 dark:bg-white/[0.03]">
              <summary className="cursor-pointer text-sm text-gray-600 dark:text-gray-300">
                补充外貌与开场白 <span className="ml-1 text-xs text-gray-400">可选</span>
              </summary>
              <label className="mt-4 block text-sm">
                外貌描述
                <textarea
                  rows={2}
                  maxLength={4000}
                  value={draft.appearance}
                  onChange={(e) => setDraft({ ...draft, appearance: e.target.value })}
                  placeholder="发色、瞳色、标志性配饰，或想保持的画风…"
                  className="character-field mt-2"
                />
              </label>
              <label className="mt-4 block text-sm">
                开场白
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={draft.opening}
                  onChange={(e) => setDraft({ ...draft, opening: e.target.value })}
                  placeholder="新对话里，TA 对你说的第一句话…"
                  className="character-field mt-2"
                />
              </label>
            </details>
            {error && (
              <p role="alert" className="text-sm text-red-500">
                {error}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between px-6 pb-6 pt-2">
          <span className="hidden text-xs text-gray-400 sm:inline">人物与聊天记录保存在本地</span>
          <button type="submit" disabled={busy || !draft.name.trim() || !draft.personality.trim()} className="character-primary">
            {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {busy ? '正在保存…' : character ? '保存人物' : '创建并开始聊天'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
