import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ImagePlus, LoaderCircle, RefreshCw, Square, X } from 'lucide-react'
import type { Character, CharacterConversation, InputImage } from '../../types'
import { createInputImageFromFile, useStore } from '../../store'
import { sendCharacterMessage, stopCharacterResponse } from '../../lib/characterChat'
import CharacterImage from './characterImage'

export default function CharacterChatView({
  character,
  conversation,
  onOpenImage,
}: {
  character: Character
  conversation: CharacterConversation
  onOpenImage: (id: string) => void
}) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<InputImage[]>([])
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  // 会话按 id 挂载，只让本次打开后收到的新消息入场，流式更新沿用同一个节点。
  const [initialMessageIds] = useState(() => new Set(conversation.messages.map((msg) => msg.id)))
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const enterSubmit = useStore((s) => s.settings.enterSubmit)
  const running = conversation.messages.some((msg) => msg.status === 'replying' || msg.status === 'imaging')

  useEffect(() => {
    if (stickToBottom.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [conversation.messages])

  useEffect(() => {
    const el = scrollRef.current
    if (!el?.firstElementChild) return
    // 图片加载后高度会变化，仍在底部时继续跟随最新消息。
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [])

  const send = async () => {
    if (running || sending || uploading || (!text.trim() && !images.length)) return
    setSending(true)
    try {
      if (
        await sendCharacterMessage(
          conversation.id,
          text,
          images.map((img) => img.id),
        )
      ) {
        setText('')
        setImages([])
        setError('')
        stickToBottom.current = true
        inputRef.current?.focus()
      }
    } catch (err) {
      console.error('发送人物消息失败', err)
      setError('消息发送失败，请重试。')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-8"
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100
        }}
      >
        <div className="mx-auto max-w-3xl py-8">
          <div className="mb-9 flex flex-col items-center text-center">
            <CharacterImage
              id={character.avatarImageId}
              name={character.name}
              avatar
              className="mb-4 h-20 w-20 rounded-full object-cover text-2xl"
            />
            <h2 className="text-lg font-semibold">{character.name}</h2>
            <span className="mt-4 text-[11px] text-gray-400">这段故事，从你们的对话开始</span>
          </div>
          <div className="space-y-7">
            {conversation.messages.map((msg, idx) => (msg.content || msg.imageIds.length || msg.status === 'replying' || (msg.status === 'error' && !msg.imageError)) && (
              <div key={msg.id} className={`flex items-start gap-3 ${initialMessageIds.has(msg.id) ? '' : 'animate-content-in'} ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                {msg.role === 'assistant' && (
                  <CharacterImage
                    id={character.avatarImageId}
                    name={character.name}
                    avatar
                    className="mt-1 h-9 w-9 shrink-0 rounded-full object-cover text-xs"
                  />
                )}
                <div className={`min-w-0 max-w-[85%] sm:max-w-[78%] ${msg.role === 'user' ? 'text-right' : ''}`}>
                  <div className="mb-1.5 text-[11px] text-gray-400">
                    {msg.role === 'user' ? '你' : character.name}
                    <span className="ml-2 opacity-70">
                      {new Date(msg.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {msg.content && (
                    <div
                      data-selectable-text
                      className={`whitespace-pre-wrap break-words rounded-3xl px-5 py-3 text-left text-sm leading-7 ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100/80 text-gray-700 dark:bg-white/[0.06] dark:text-gray-200'}`}
                    >
                      {msg.content}
                    </div>
                  )}
                  {msg.imageIds.length > 0 && (
                    <div className={`mt-2 grid gap-2 ${msg.imageIds.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                      {msg.imageIds.map((id, imageIdx) => (
                        <button
                          key={`${id}-${imageIdx}`}
                          onClick={() => onOpenImage(id)}
                          className="overflow-hidden rounded-3xl text-left"
                          aria-label="查看聊天图片"
                        >
                          <CharacterImage
                            id={id}
                            name={`${character.name}的聊天图片`}
                            className="max-h-[440px] w-full max-w-sm object-contain"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                  {msg.status === 'replying' && !msg.content && (
                    <div
                      role="status"
                      aria-label={`${character.name}正在输入`}
                      className="inline-flex items-center gap-1.5 rounded-3xl bg-gray-100/80 px-5 py-4 dark:bg-white/[0.06]"
                    >
                      {[0, 1, 2].map((dot) => <span key={dot} aria-hidden="true" className="typing-dot h-1.5 w-1.5 rounded-full bg-gray-400" style={{ animationDelay: `${dot * 160}ms` }} />)}
                    </div>
                  )}
                  {msg.error && !msg.imageError && (
                    <p
                      role="alert"
                      data-selectable-text
                      className="mt-2 whitespace-pre-wrap break-words text-left text-xs leading-5 text-red-500"
                    >
                      这条回复暂时没能送达。
                    </p>
                  )}
                  {msg.role === 'assistant' && msg.status === 'error' && !msg.imageError && idx === conversation.messages.length - 1 && (
                    <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
                      <button
                        disabled={running}
                        className="flex items-center gap-1 hover:text-blue-500 disabled:opacity-40"
                        onClick={() => void sendCharacterMessage(conversation.id, '', [], msg.id)}
                      >
                        <RefreshCw size={12} />
                        重试回复
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {!conversation.messages.length && (
            <div className="mt-10 flex flex-wrap justify-center gap-2">
              {['你好，介绍一下自己吧', '今天过得怎么样？', '发张你的照片看看'].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => {
                    setText(prompt)
                    inputRef.current?.focus()
                  }}
                  className="rounded-full bg-blue-50/70 px-4 py-2.5 text-xs text-gray-500 transition hover:bg-blue-100 hover:text-blue-600 dark:bg-white/[0.05] dark:text-gray-400 dark:hover:bg-blue-500/10"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 px-4 pb-3 pt-2 sm:px-8" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <form
          className="mx-auto max-w-3xl rounded-3xl bg-gray-100/80 p-4 transition focus-within:ring-2 focus-within:ring-blue-200 dark:bg-white/[0.06] dark:focus-within:ring-blue-500/30"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          {images.length > 0 && (
            <div className="mb-2 flex gap-2">
              {images.map((img) => (
                <div key={img.id} className="relative">
                  <img src={img.dataUrl} alt="待发送图片" className="h-16 w-16 rounded-2xl object-cover" />
                  <button
                    type="button"
                    aria-label="移除待发送图片"
                    onClick={() => setImages(images.filter((item) => item.id !== img.id))}
                    className="absolute -right-1 -top-1 rounded-full bg-gray-800 p-0.5 text-white"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            aria-label={`与${character.name}聊天`}
            placeholder={`和${character.name}说点什么…`}
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.shiftKey && (enterSubmit || e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void send()
              }
            }}
            className="max-h-36 min-h-12 w-full resize-none bg-transparent px-1 text-sm leading-6 outline-none placeholder:text-gray-400"
          />
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || images.length >= 4}
              className="character-icon-button"
              aria-label="上传聊天图片"
              title="上传聊天图片"
            >
              {uploading ? <LoaderCircle size={19} className="animate-spin" /> : <ImagePlus size={19} />}
            </button>
            <span className="ml-auto mr-3 hidden text-[11px] text-gray-400 sm:inline">
              {enterSubmit ? 'Enter 发送 · Shift + Enter 换行' : 'Ctrl / ⌘ + Enter 发送'}
            </span>
            {running ? (
              <button
                type="button"
                onClick={() => stopCharacterResponse(conversation.id)}
                className="character-primary !p-2.5"
                aria-label="停止回复"
              >
                <Square size={17} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={sending || uploading || (!text.trim() && !images.length)}
                className="character-primary !p-2.5"
                aria-label="发送消息"
              >
                <ArrowUp size={18} />
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? [])
              setUploading(true)
              setError('')
              try {
                const next = [...images]
                for (const file of files) {
                  if (next.length >= 4) throw new Error('每条消息最多附 4 张图片。')
                  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 20 * 1024 * 1024)
                    throw new Error('请上传 20 MB 以内的 PNG、JPG、WebP 或 GIF 图片。')
                  const img = await createInputImageFromFile(file)
                  if (img && !next.some((item) => item.id === img.id)) next.push(img)
                  setImages([...next])
                }
              } catch (err) {
                console.warn('聊天图片上传失败', err)
                setError(err instanceof Error ? err.message : '上传失败，请重试。')
              } finally {
                setUploading(false)
                if (fileRef.current) fileRef.current.value = ''
              }
            }}
          />
        </form>
        {error && (
          <p role="alert" className="mx-auto mt-2 max-w-3xl text-xs text-red-500">
            {error}
          </p>
        )}
      </div>
    </>
  )
}
