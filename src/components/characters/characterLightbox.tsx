import { useEffect, useRef, useState } from 'react'
import { Download, UserRoundPlus, X } from 'lucide-react'
import type { Character } from '../../types'
import { saveCharacters, useCharacterStore } from '../../characterStore'
import { downloadImageIds } from '../../lib/downloadImages'
import CharacterImage from './characterImage'

export default function CharacterLightbox({ imageId, character, closing, onClose }: { imageId: string; character: Character; closing: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      data-closing={closing}
      inert={closing}
      aria-label={`${character.name}的图片`}
      className="character-dialog w-[min(1000px,calc(100%-24px))] rounded-3xl bg-white p-0 text-gray-900 shadow-2xl backdrop:bg-gray-950/30 backdrop:backdrop-blur-sm dark:bg-gray-950 dark:text-gray-100 dark:backdrop:bg-black/80"
      onCancel={(e) => {
        e.preventDefault()
        if (!closing) onClose()
      }}
    >
      <div className="flex items-center justify-between gap-2 p-3">
        <span className="px-2 text-sm">{character.name}的图片</span>
        <button className="character-icon-button" onClick={onClose} aria-label="关闭图片预览">
          <X size={20} />
        </button>
      </div>
      <div className="bg-gray-50 dark:bg-black/20">
        <CharacterImage id={imageId} name={`${character.name}的图片`} className="max-h-[68dvh] min-h-40 w-full object-contain" />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 p-4">
        {notice && (
          <span role="status" className="mr-auto text-sm text-gray-500 dark:text-gray-300">
            {notice}
          </span>
        )}
        <button
          className="character-secondary"
          onClick={async () => {
            const result = await downloadImageIds([imageId], `${character.name}-图片`)
            setNotice(result.failCount ? '下载失败，请重试。' : '已开始下载')
          }}
        >
          <Download size={16} />
          下载
        </button>
        <button
          disabled={busy || character.referenceImageIds.includes(imageId)}
          className="character-primary"
          onClick={async () => {
            if (character.referenceImageIds.length >= 8) {
              setNotice('参考图已满，请先在人物资料中移除一张。')
              return
            }
            setBusy(true)
            try {
              useCharacterStore
                .getState()
                .saveCharacter({ ...character, referenceImageIds: [...character.referenceImageIds, imageId], updatedAt: Date.now() })
              await saveCharacters()
              setNotice('已添加为人物参考图')
            } catch (err) {
              console.error('参考图保存失败', err)
              setNotice('保存失败，请重试。')
            } finally {
              setBusy(false)
            }
          }}
        >
          <UserRoundPlus size={16} />
          {character.referenceImageIds.includes(imageId) ? '已是参考图' : '用作人物参考图'}
        </button>
      </div>
    </dialog>
  )
}
