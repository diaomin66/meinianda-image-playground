import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  Activity,
  BookOpen,
  ChevronRight,
  History,
  Image as ImageIcon,
  LoaderCircle,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import type { Character } from '../types'
import { loadCharacters, saveCharacters, useCharacterStore } from '../characterStore'
import { useStore } from '../store'
import CharacterImage from './characters/characterImage'
import CharacterEditor from './characters/characterEditor'
import CharacterChatView from './characters/characterChatView'
import CharacterLightbox from './characters/characterLightbox'
import CharacterLogViewer from './characters/characterLogViewer'
import { isCharacterImageJobActive } from '../lib/characterImageJobState'
import { useExitPresence } from '../hooks/useExitPresence'
import { applyCharacterLifeSchedule, ensureCharacterLifeSchedule, getCharacterLifeDate } from '../lib/characterLifeScheduler'
import './characters/characters.css'

export default function CharacterWorkspace() {
  const state = useCharacterStore()
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<Character | 'new' | null>(null)
  const [panel, setPanel] = useState<'profile' | 'album' | 'history' | null>(null)
  const [imageId, setImageId] = useState<string | null>(null)
  const [logConversation, setLogConversation] = useState<{ id: string; title: string } | null>(null)
  const [selectedConversationIds, setSelectedConversationIds] = useState<string[]>([])
  const [rewritingLifeId, setRewritingLifeId] = useState<string | null>(null)
  const logPresence = useExitPresence(logConversation)
  const editorPresence = useExitPresence(editor)
  const panelPresence = useExitPresence(panel)
  const imagePresence = useExitPresence(imageId)
  const visiblePanel = panelPresence.value
  const character = state.characters.find((char) => char.id === state.activeCharacterId)
  const conversation = state.conversations.find((convo) => convo.id === state.activeConversationId && convo.characterId === character?.id)
  const conversations = state.conversations.filter((convo) => convo.characterId === character?.id).sort((a, b) => b.updatedAt - a.updatedAt)
  const selectableIds = new Set(conversations.filter((convo) => !convo.messages.some((msg) => msg.status === 'replying' || msg.status === 'imaging' || msg.imageJobs?.some(isCharacterImageJobActive))).map((convo) => convo.id))
  const selectedIds = selectedConversationIds.filter((id) => selectableIds.has(id))
  const allSelected = selectableIds.size > 0 && selectedIds.length === selectableIds.size
  const album = [
    ...new Set(conversations.flatMap((convo) => convo.messages.filter((msg) => msg.role === 'assistant').flatMap((msg) => msg.imageIds))),
  ].reverse()
  const characters = state.characters.filter((char) => `${char.name} ${char.personality}`.toLowerCase().includes(search.toLowerCase()))
  const running = conversations.some((convo) => convo.messages.some((msg) => msg.status === 'replying' || msg.status === 'imaging' || msg.imageJobs?.some(isCharacterImageJobActive)))

  useEffect(() => {
    void loadCharacters().catch(() => {})
  }, [])
  useEffect(() => {
    setPanel(null)
    setImageId(null)
    setSelectedConversationIds([])
  }, [state.activeCharacterId])

  useEffect(() => {
    if (panel !== 'history') setSelectedConversationIds([])
  }, [panel])

  return (
    <main className="character-workspace flex min-h-0 min-w-0 flex-1 flex-col bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {state.storageError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-center gap-3 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"
        >
          {state.storageError}
          <button className="underline" onClick={() => void (state.loaded ? saveCharacters() : loadCharacters()).catch(() => {})}>
            重试{state.loaded ? '保存' : '加载'}
          </button>
        </div>
      )}
      {!state.loaded ? (
        <div role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-gray-400">
          <LoaderCircle size={18} className="animate-spin" />
          正在加载人物…
        </div>
      ) : !character || !conversation ? (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="mb-3 flex items-center gap-2 text-xs font-medium tracking-[0.2em] text-blue-500">
                  <Users size={15} />
                  人物（beta）
                </div>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">让故事，从相遇开始。</h1>
                <p className="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400">赋予 TA 性格与模样，在对话里慢慢熟悉。</p>
              </div>
              <button className="character-primary" onClick={() => setEditor('new')}>
                <Plus size={18} />
                创建人物
              </button>
            </div>
            <div className="mb-6 mt-10 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="font-medium">我的人物</h2>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                  {state.characters.length}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-gray-400 dark:bg-white/5">
                  <Search size={16} />
                  <input
                    aria-label="搜索人物"
                    placeholder="搜索人物…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-28 bg-transparent text-sm outline-none sm:w-40"
                  />
                </label>
                <button
                  className="character-icon-button"
                  title="人物配置"
                  aria-label="人物配置"
                  onClick={() => useStore.getState().setShowSettings(true, 'characters')}
                >
                  <Settings2 size={18} />
                </button>
              </div>
            </div>
            {!state.characters.length ? (
              <div className="character-empty-grid relative grid overflow-hidden rounded-[32px] bg-white px-7 py-12 dark:bg-gray-900/40 sm:grid-cols-2 sm:px-14 sm:py-20">
                <div className="relative z-10 self-center">
                  <span className="mb-5 inline-flex rounded-full bg-blue-50 px-3 py-1 text-[11px] text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                    每个人物，都有自己的故事
                  </span>
                  <h2 className="text-2xl font-semibold leading-relaxed sm:text-3xl">
                    一个名字，
                    <br />
                    一种性格，无数种可能。
                  </h2>
                  <p className="mt-4 max-w-xs text-sm leading-7 text-gray-500 dark:text-gray-400">
                    创建你心中的人物，上传形象参考图。聊聊日常，也收下 TA 为你分享的每一张图片。
                  </p>
                  <button className="character-primary mt-7" onClick={() => setEditor('new')}>
                    <Plus size={17} />
                    创建第一个人物
                    <ArrowUpRight size={16} />
                  </button>
                </div>
                <div className="relative mx-auto mt-12 h-64 w-64 sm:mt-0" aria-hidden="true">
                  <div className="absolute left-0 top-5 h-56 w-44 -rotate-12 rounded-[32px] bg-blue-100/70 dark:bg-blue-900/30" />
                  <div className="absolute left-10 top-1 flex h-60 w-44 rotate-6 flex-col items-center rounded-[32px] bg-white p-5 shadow-xl shadow-blue-200/40 dark:bg-gray-800 dark:shadow-none">
                    <div className="character-portrait flex h-32 w-full items-center justify-center rounded-2xl">
                      <Users size={52} strokeWidth={1} className="text-blue-400" />
                    </div>
                    <div className="mt-5 h-2 w-16 rounded-full bg-blue-200 dark:bg-blue-400/30" />
                    <div className="mt-3 h-1.5 w-24 rounded-full bg-gray-100 dark:bg-white/10" />
                    <span className="mt-3 text-[10px] text-gray-400">等待与你相遇</span>
                  </div>
                  <div className="absolute -right-3 top-7 flex items-center gap-2 rounded-full bg-white px-4 py-3 text-xs text-gray-500 shadow-sm dark:bg-gray-800">
                    <MessageCircle size={15} className="text-blue-400" />
                    你好，很高兴认识你。
                  </div>
                  <div className="absolute -bottom-3 left-0 rounded-2xl bg-blue-600 p-3 text-white shadow-lg shadow-blue-300/30">
                    <Sparkles size={22} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {characters.map((char) => {
                  const latest = state.conversations
                    .filter((convo) => convo.characterId === char.id)
                    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
                  const message = latest?.messages[latest.messages.length - 1]
                  return (
                    <button
                      key={char.id}
                      onClick={() => state.selectCharacter(char.id)}
                      className="group rounded-[28px] bg-white p-6 text-left transition duration-200 hover:-translate-y-1 hover:bg-blue-50/60 hover:shadow-lg hover:shadow-blue-100/40 dark:bg-gray-900/60 dark:hover:bg-blue-500/10 dark:hover:shadow-none"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <CharacterImage
                          id={char.avatarImageId}
                          name={char.name}
                          avatar
                          className="h-20 w-20 shrink-0 rounded-full object-cover text-2xl"
                        />
                        <span className="rounded-full bg-blue-50 p-2 text-blue-600 transition group-hover:bg-blue-600 group-hover:text-white dark:bg-blue-500/10 dark:text-blue-400">
                          <ArrowUpRight size={17} />
                        </span>
                      </div>
                      <div className="mt-5">
                        <h3 className="truncate text-lg font-semibold">{char.name}</h3>
                        <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
                          <MessageCircle size={13} />
                          <span className="truncate">{message ? message.content || '分享了一张图片' : '开始你们的第一段对话'}</span>
                        </div>
                      </div>
                    </button>
                  )
                })}
                {!search && (
                  <button
                    onClick={() => setEditor('new')}
                    className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-[28px] bg-blue-50/60 text-blue-500 transition hover:bg-blue-100/70 dark:bg-blue-500/5 dark:hover:bg-blue-500/10"
                  >
                    <span className="rounded-full bg-white p-4 dark:bg-gray-900">
                      <Plus size={25} strokeWidth={1.5} />
                    </span>
                    <span className="text-sm">再认识一个人物</span>
                  </button>
                )}
              </div>
            )}
            {!!state.characters.length && !characters.length && (
              <p className="py-10 text-center text-sm text-gray-400">没有找到匹配的人物</p>
            )}
            <div className="mt-7 flex flex-wrap justify-center gap-x-7 gap-y-2 text-xs text-gray-400">
              <span className="flex items-center gap-2">
                <BookOpen size={14} />
                自由定义人格
              </span>
              <span className="flex items-center gap-2">
                <ImageIcon size={14} />
                多图形象参考
              </span>
              <span className="flex items-center gap-2">
                <MessageCircle size={14} />
                自然聊天与发图
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 gap-3 p-2 sm:p-3">
          <aside className="hidden w-56 shrink-0 flex-col rounded-[28px] bg-white/70 p-4 dark:bg-gray-900/40 lg:flex">
            <button
              onClick={() => useCharacterStore.setState({ activeCharacterId: null, activeConversationId: null })}
              className="mb-6 flex items-center gap-2 rounded-full px-3 py-2 text-xs text-gray-500 hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-500/10"
            >
              <ArrowLeft size={15} />
              全部人物
            </button>
            <div className="mb-4 flex items-center justify-between px-2">
              <span className="text-xs font-medium text-gray-400">我的人物</span>
              <button className="character-icon-button !h-7 !w-7" aria-label="创建新人物" onClick={() => setEditor('new')}>
                <Plus size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {state.characters.map((char) => (
                <button
                  key={char.id}
                  onClick={() => state.selectCharacter(char.id)}
                  className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left ${char.id === character.id ? 'bg-blue-100/70 dark:bg-blue-500/10' : 'hover:bg-gray-100 dark:hover:bg-white/5'}`}
                >
                  <CharacterImage
                    id={char.avatarImageId}
                    name={char.name}
                    avatar
                    className="h-10 w-10 shrink-0 rounded-full object-cover text-sm"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{char.name}</p>
                  </div>
                </button>
              ))}
            </div>
            <button
              onClick={() => useStore.getState().setShowSettings(true, 'characters')}
              className="mt-4 flex items-center gap-2 rounded-full px-3 py-2 text-xs text-gray-400 hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-500/10"
            >
              <Settings2 size={15} />
              人物配置（beta）
            </button>
          </aside>
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[28px] bg-white dark:bg-gray-900/40">
            <div className="flex h-[72px] shrink-0 items-center gap-3 px-3 sm:px-6">
              <button
                aria-label="返回人物列表"
                onClick={() => useCharacterStore.setState({ activeCharacterId: null, activeConversationId: null })}
                className="character-icon-button lg:!hidden"
              >
                <ArrowLeft size={18} />
              </button>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-base font-semibold">{character.name}</h1>
                <p className="mt-1 truncate text-[11px] text-gray-400">
                  {conversation.title === '新对话' ? '你们的故事，正在发生' : conversation.title}
                </p>
              </div>
              <button
                onClick={() => setPanel(panel === 'history' ? null : 'history')}
                aria-label="历史对话"
                title="历史对话"
                className="character-icon-button"
              >
                <History size={18} />
              </button>
              <button onClick={() => setLogConversation({ id: conversation.id, title: `${character.name} · ${conversation.title}` })} aria-label="查看对话日志" title="对话日志" className="character-icon-button"><Activity size={18} /></button>
              <button
                onClick={() => setPanel(panel === 'album' ? null : 'album')}
                className={`character-secondary !gap-1.5 !px-2.5 !py-2 !text-xs ${panel === 'album' ? '!bg-blue-100 !text-blue-600 dark:!bg-blue-500/20 dark:!text-blue-300' : ''}`}
              >
                <ImageIcon size={15} />
                相册
              </button>
              <button
                onClick={() => setPanel(panel === 'profile' ? null : 'profile')}
                className={`character-secondary !gap-1.5 !px-2.5 !py-2 !text-xs ${panel === 'profile' ? '!bg-blue-100 !text-blue-600 dark:!bg-blue-500/20 dark:!text-blue-300' : ''}`}
              >
                <BookOpen size={15} />
                资料
              </button>
            </div>
            <CharacterChatView key={conversation.id} character={character} conversation={conversation} onOpenImage={setImageId} />
          </section>
          {visiblePanel && (
            <>
              <button data-closing={panelPresence.closing} inert={panelPresence.closing} className="character-panel-backdrop absolute inset-0 z-10 rounded-[28px] bg-black/20 backdrop-blur-sm xl:hidden" aria-label="关闭人物侧栏" onClick={() => setPanel(null)} />
              <aside data-closing={panelPresence.closing} inert={panelPresence.closing} className="character-side-panel absolute bottom-2 right-2 top-2 z-20 flex w-[min(340px,92%)] shrink-0 flex-col overflow-hidden rounded-[28px] bg-white shadow-xl dark:bg-gray-900 sm:bottom-3 sm:right-3 sm:top-3 xl:static xl:w-80 xl:shadow-none">
                <div className="flex h-[72px] shrink-0 items-center justify-between px-5">
                  <h2 className="text-sm font-semibold">
                    {visiblePanel === 'profile' ? '人物资料' : visiblePanel === 'album' ? `人物相册 · ${album.length}` : '历史对话'}
                  </h2>
                  <button className="character-icon-button" aria-label="关闭侧栏" onClick={() => setPanel(null)}>
                    <X size={18} />
                  </button>
                </div>
                <div key={visiblePanel} className="animate-content-in min-h-0 flex-1 overflow-y-auto p-5">
                  {visiblePanel === 'profile' && (
                    <div className="space-y-6">
                      <div className="flex items-center gap-3">
                        <CharacterImage
                          id={character.avatarImageId}
                          name={character.name}
                          avatar
                          className="h-16 w-16 rounded-full object-cover text-xl"
                        />
                        <div className="min-w-0">
                          <h3 className="truncate text-lg font-semibold">{character.name}</h3>
                          <button onClick={() => setEditor(character)} className="mt-1 flex items-center gap-1 text-xs text-blue-500">
                            <Pencil size={12} />
                            编辑人物
                          </button>
                        </div>
                      </div>
                      <details className="rounded-2xl bg-gray-50 p-4 dark:bg-white/5">
                        <summary className="cursor-pointer text-xs text-gray-500 dark:text-gray-400">查看人格设定</summary>
                        <p
                          data-selectable-text
                          className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-gray-600 dark:text-gray-300"
                        >
                          {character.personality}
                        </p>
                      </details>
                      {character.appearance && (
                        <div>
                          <h3 className="mb-2 text-xs text-gray-400">外貌描述</h3>
                          <p
                            data-selectable-text
                            className="whitespace-pre-wrap break-words text-sm leading-7 text-gray-600 dark:text-gray-300"
                          >
                            {character.appearance}
                          </p>
                        </div>
                      )}
                      <div>
                        <h3 className="mb-3 text-xs text-gray-400">形象参考 · {character.referenceImageIds.length}</h3>
                        <div className="grid grid-cols-3 gap-2">
                          {character.referenceImageIds.map((id) => (
                            <button key={id} onClick={() => setImageId(id)} aria-label="查看人物参考图">
                              <CharacterImage id={id} className="aspect-square w-full rounded-xl object-cover" />
                            </button>
                          ))}
                        </div>
                        {!character.referenceImageIds.length && (
                          <button onClick={() => setEditor(character)} className="text-xs text-blue-500">
                            添加参考图
                            <ChevronRight className="inline" size={13} />
                          </button>
                        )}
                      </div>
                      <div className="rounded-3xl bg-blue-50 p-4 dark:bg-blue-500/5">
                        <label className="flex items-center justify-between gap-3 text-sm">
                          <span>允许主动发图</span>
                          <input
                            type="checkbox"
                            role="switch"
                            className="character-switch"
                            checked={character.autoImages}
                            onChange={(e) => state.saveCharacter({ ...character, autoImages: e.target.checked, updatedAt: Date.now() })}
                          />
                        </label>
                        <p className="mt-2 text-xs leading-5 text-gray-500">让 TA 在聊天时主动分享照片。关闭后，只有你开口时才会发图。</p>
                      </div>
                      <div className="rounded-3xl bg-blue-50 p-4 dark:bg-blue-500/5">
                        <div className="flex items-center justify-between gap-3">
                          <label className="flex items-center gap-3 text-sm">
                            <input
                              type="checkbox"
                              role="switch"
                              className="character-switch"
                              checked={character.lifeSchedulerEnabled === true}
                              onChange={(e) => state.saveCharacter({ ...character, lifeSchedulerEnabled: e.target.checked, updatedAt: Date.now() })}
                            />
                            <span>生活日程</span>
                          </label>
                          <input
                            aria-label="每日切换时间"
                            type="time"
                            value={character.lifeScheduleTime || '07:00'}
                            onChange={(e) => state.saveCharacter({ ...character, lifeScheduleTime: e.target.value || '07:00', updatedAt: Date.now() })}
                            className="rounded-full border-0 bg-white/80 px-3 py-1.5 text-xs text-blue-700 outline-none dark:bg-white/10 dark:text-blue-300"
                          />
                        </div>
                        <p className="mt-2 text-xs leading-5 text-gray-500">以所选时间划分新的一天，聊天时自动补齐当天的穿搭和日程。当前日：{getCharacterLifeDate(character)}。</p>
                        {character.lifeSchedule?.date === getCharacterLifeDate(character) ? (
                          <div className="mt-3 rounded-2xl bg-white/70 p-3 text-xs leading-5 text-gray-600 dark:bg-white/5 dark:text-gray-300">
                            <p className="font-medium text-blue-600 dark:text-blue-300">{character.lifeSchedule.outfitStyle || '今日状态'}</p>
                            <p className="mt-1">穿着：{character.lifeSchedule.outfit || '未记录'}</p>
                            <p className="mt-1 whitespace-pre-wrap">日程：{character.lifeSchedule.schedule || '未记录'}</p>
                          </div>
                        ) : <p className="mt-3 text-xs text-gray-400">首次聊天时会自动生成今日状态。</p>}
                        <button
                          disabled={character.lifeSchedulerEnabled !== true || running || rewritingLifeId !== null}
                          className="mt-3 rounded-full px-3 py-2 text-xs text-blue-600 hover:bg-blue-100 disabled:opacity-40 dark:text-blue-300 dark:hover:bg-blue-500/10"
                          onClick={async () => {
                            setRewritingLifeId(character.id)
                            try {
                              const schedule = await ensureCharacterLifeSchedule(character, conversation, useStore.getState().settings, '请重新规划今天的生活，和之前不同。')
                              if (!schedule) throw new Error('未能生成完整日程，请检查语言模型配置后重试。')
                              const latest = useCharacterStore.getState().characters.find((item) => item.id === character.id)
                              if (latest?.lifeSchedulerEnabled === true && schedule.date === getCharacterLifeDate(latest)) state.saveCharacter(applyCharacterLifeSchedule(latest, schedule))
                            } catch (err) {
                              console.warn('生活日程重写失败', err)
                              useStore.getState().showToast(err instanceof Error ? err.message : '生活日程重写失败，请重试。', 'error')
                            } finally {
                              setRewritingLifeId(null)
                            }
                          }}
                        >
                          {rewritingLifeId === character.id ? '正在安排今日生活…' : '重写今日日程'}
                        </button>
                      </div>
                      <button
                        className="flex items-center gap-2 rounded-full px-3 py-2 text-xs text-gray-400 hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-500/10"
                        onClick={() => useStore.getState().setShowSettings(true, 'characters')}
                      >
                        <Settings2 size={14} />
                        聊天与生图配置
                      </button>
                      <button
                        disabled={running}
                        className="flex items-center gap-2 rounded-full px-3 py-2 text-xs text-red-400 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-500/10"
                        onClick={() =>
                          useStore
                            .getState()
                            .setConfirmDialog({
                              title: `删除${character.name}？`,
                              message: '人物资料、所有聊天记录和人物相册入口将被删除。',
                              confirmText: '删除人物',
                              action: () => state.deleteCharacter(character.id),
                            })
                        }
                      >
                        <Trash2 size={14} />
                        删除人物
                      </button>
                    </div>
                  )}
                  {visiblePanel === 'album' &&
                    (album.length ? (
                      <div className="grid grid-cols-2 gap-2">
                        {album.map((id) => (
                          <button key={id} onClick={() => setImageId(id)} className="overflow-hidden rounded-2xl" aria-label="查看相册图片">
                            <CharacterImage id={id} className="aspect-[3/4] w-full object-cover" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="py-16 text-center text-gray-400">
                        <ImageIcon size={30} className="mx-auto mb-4 opacity-50" />
                        <p className="text-sm">还没有共同的画面</p>
                        <p className="mt-2 text-xs leading-6">
                          聊天中生成的图片
                          <br />
                          会自动收藏在这里。
                        </p>
                      </div>
                    ))}
                  {visiblePanel === 'history' && (
                    <>
                      <div className="mb-5 flex items-center gap-2">
                        <button
                          className="character-primary min-w-0 flex-1"
                          onClick={() => {
                            state.newConversation(character.id)
                            setPanel(null)
                          }}
                        >
                          <Plus size={16} />
                          开启新对话
                        </button>
                        <button
                          className="rounded-full bg-gray-100 px-3 py-2 text-xs text-gray-500 transition hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/5 dark:text-gray-400 dark:hover:bg-blue-500/10 dark:hover:text-blue-300"
                          disabled={!selectableIds.size}
                          onClick={() => setSelectedConversationIds(allSelected ? [] : [...selectableIds])}
                        >
                          {allSelected ? '取消全选' : '全选'}
                        </button>
                      </div>
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <p className="text-xs leading-5 text-gray-400">新对话沿用人物设定，重新开始聊天。</p>
                        {selectedIds.length > 0 && (
                          <button
                            className="rounded-full px-3 py-2 text-xs text-red-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                            onClick={() => useStore.getState().setConfirmDialog({
                              title: `删除 ${selectedIds.length} 段对话？`,
                              message: '所选对话的聊天记录和对应人物相册入口将被删除，人物资料会保留。正在进行的对话不会被删除。此操作无法撤销。',
                              confirmText: '批量删除',
                              action: () => {
                                const count = state.deleteConversations(selectedIds)
                                setSelectedConversationIds([])
                                if (count) useStore.getState().showToast(`已删除 ${count} 段对话`, 'success')
                              },
                            })}
                          >
                            删除所选（{selectedIds.length}）
                          </button>
                        )}
                      </div>
                      <div className="space-y-2">
                        {conversations.map((convo) => {
                          const busy = convo.messages.some((msg) => msg.status === 'replying' || msg.status === 'imaging' || msg.imageJobs?.some(isCharacterImageJobActive))
                          const selected = selectedIds.includes(convo.id)
                          return (
                            <div key={convo.id} className={`flex items-center gap-1 rounded-2xl pr-2 ${selected ? 'bg-blue-50 dark:bg-blue-500/10' : convo.id === conversation.id ? 'bg-blue-50/60 dark:bg-blue-500/5' : 'hover:bg-gray-50 dark:hover:bg-white/5'}`}>
                              <button
                                type="button"
                                disabled={busy}
                                aria-label={selected ? `取消选择对话：${convo.title}` : `选择对话：${convo.title}`}
                                aria-pressed={selected}
                                onClick={() => setSelectedConversationIds((current) => current.includes(convo.id) ? current.filter((id) => id !== convo.id) : [...current, convo.id])}
                                className={`ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition ${selected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-transparent hover:bg-blue-100 dark:bg-white/10 dark:hover:bg-blue-500/20'} disabled:cursor-not-allowed disabled:opacity-30`}
                              >
                                <span className="h-2 w-2 rounded-full bg-current" />
                              </button>
                              <button
                                onClick={() => {
                                  useCharacterStore.setState({ activeConversationId: convo.id })
                                  setPanel(null)
                                }}
                                className="min-w-0 flex-1 rounded-2xl p-4 text-left"
                                aria-current={convo.id === conversation.id ? 'true' : undefined}
                              >
                                <p className="truncate text-sm">{convo.title}</p>
                                <p className="mt-1 text-[11px] text-gray-400">
                                  {new Date(convo.updatedAt).toLocaleDateString('zh-CN')} · {convo.messages.length} 条消息
                                </p>
                              </button>
                              <button
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-blue-100 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-blue-500/20 dark:hover:text-blue-400"
                                aria-label={`删除对话：${convo.title}`}
                                title={busy ? '请稍后再删除这段对话' : '删除对话'}
                                disabled={busy}
                                onClick={() => useStore.getState().setConfirmDialog({
                                  title: '删除这段对话？',
                                  message: `「${convo.title}」的聊天记录及对应人物相册入口将被删除，人物资料会保留。此操作无法撤销。`,
                                  confirmText: '删除对话',
                                  action: () => {
                                    if (!state.deleteConversation(convo.id)) useStore.getState().showToast('这段对话还在进行，请稍后再删除。', 'error')
                                  },
                                })}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              </aside>
            </>
          )}
        </div>
      )}
      {editorPresence.value && (
        <CharacterEditor
          key={editorPresence.value === 'new' ? 'new' : editorPresence.value.id}
          character={editorPresence.value === 'new' ? null : editorPresence.value}
          closing={editorPresence.closing}
          onClose={() => setEditor(null)}
          onSaved={(id) => {
            setEditor(null)
            if (id !== state.activeCharacterId) state.selectCharacter(id)
          }}
        />
      )}
      {imagePresence.value && character && <CharacterLightbox imageId={imagePresence.value} character={character} closing={imagePresence.closing} onClose={() => setImageId(null)} />}
      {logPresence.value && <CharacterLogViewer conversationId={logPresence.value.id} title={logPresence.value.title} closing={logPresence.closing} onClose={() => setLogConversation(null)} />}
    </main>
  )
}
