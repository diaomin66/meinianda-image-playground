import { useEffect, useState } from 'react'
import { ImageOff, UserRound } from 'lucide-react'
import { ensureImageCached, getCachedImage } from '../../lib/imageCache'

export default function CharacterImage({
  id,
  name = '',
  className = '',
  avatar = false,
}: {
  id?: string
  name?: string
  className?: string
  avatar?: boolean
}) {
  const [image, setImage] = useState<{ id?: string; url?: string }>({ id, url: id ? getCachedImage(id) : undefined })
  useEffect(() => {
    let cancelled = false
    if (id)
      void ensureImageCached(id)
        .then((url) => {
          if (!cancelled) setImage({ id, url })
        })
        .catch((err) => console.warn('人物图片加载失败', err))
    return () => {
      cancelled = true
    }
  }, [id])
  const url = image.id === id ? image.url : undefined
  return url ? (
    <img src={url} alt={avatar ? `${name}的头像` : name || '人物图片'} className={className} loading="lazy" />
  ) : (
    <div
      role={avatar ? 'img' : undefined}
      aria-label={avatar ? `${name || '人物'}的默认头像` : undefined}
      className={`flex items-center justify-center bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300 ${className}`}
    >
      {avatar ? (
        name ? (
          <span className="font-medium">{Array.from(name.trim()).slice(0, 2).join('')}</span>
        ) : (
          <UserRound className="h-1/3 w-1/3" strokeWidth={1.2} />
        )
      ) : (
        <ImageOff size={22} />
      )}
    </div>
  )
}
