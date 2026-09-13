import type { CharacterImageOptimizerSettings } from '../types'

// 移植自 diaomin66/astrbot_plugin_omnidraw/core/prompt_optimizer.py
// 上游版本：670d021893be018ba2fbbb21b7bd85d250c59188；保留五套预设及单图、多图提示词原文。
const STYLE_PRESETS = {
  photo: {
    role: 'a senior prompt editor for authentic everyday smartphone photography',
    subject: 'ordinary real person or subject with believable proportions, relaxed candid expression, natural skin with balanced micro-texture, subtle pores only where appropriate, no beauty-retouch look, no exaggerated flaws',
    clothing: 'everyday clothing with believable fabric weight, natural wrinkles, normal fit, practical styling, no fashion editorial exaggeration',
    environment: 'specific everyday real-world place, lived-in but not messy, small natural background details, realistic object scale and depth',
    lighting: 'available ambient light from windows, ceiling lights, street lights, or phone flash only when appropriate, soft imperfect shadows, no studio setup, no glossy HDR highlights',
    camera: 'casual smartphone photo, natural colors, mild sensor noise, deep depth of field, normal autofocus, slight hand-held imperfection, no cinematic grading, no artificial bokeh',
    quality: 'keep the scene casual and unposed, avoid showroom perfection, avoid over-clean backgrounds, keep surfaces and skin matte to naturally satin, never oily or reflective',
  },
  selfie: {
    role: 'an expert mobile selfie realism editor, portrait retoucher, and human anatomy quality controller',
    subject: 'natural everyday human selfie, believable age and facial structure, preserved identity, normal facial asymmetry, relaxed candid micro-expression, clear natural eyes, healthy matte-to-satin skin, balanced fine skin texture, very subtle pores, no waxy smoothness, no gritty rough pores, no oily shine, no wet glossy skin, no plastic beauty filter',
    clothing: 'casual daily outfit that fits the body naturally, realistic collar and shoulder structure, believable fabric folds, no floating fabric, no impossible neckline, no overly styled costume unless requested',
    environment: 'ordinary daily-life background such as bedroom, bathroom mirror, elevator, hallway, cafe, street, office, campus, car interior, or home corner, real object scale, mild background clutter, not a studio set',
    lighting: 'real available light from a window, ceiling lamp, screen glow, street light, or soft phone flash, gentle uneven illumination, realistic catchlights, natural shadows under nose and chin, no beauty dish, no glossy specular skin, no overexposure',
    camera: 'front-facing smartphone selfie, natural arm-length framing, believable shoulder and neck geometry, slight wide-angle perspective without face distortion, normal crop from chest or shoulders, deep depth of field, unedited phone color, mild sensor noise, no professional retouching',
    quality: 'strict anatomy guardrails: one head, one torso, two arms when visible, natural hand size, plausible fingers, no twisted wrists, no elongated arm, no broken shoulder, no extra teeth, no crossed eyes, no melted ears, no warped jaw, no uncanny symmetry, keep the selfie angle comfortable and physically possible',
  },
  cinema: {
    role: 'an elite cinematographer and high-end photographic prompt engineer',
    subject: 'realistic subject with expressive but believable emotion, refined details, natural anatomy, cinematic presence without fantasy deformation',
    clothing: 'intentional styling with accurate fabric material, weight, seams, wrinkles, and gravity-aware drape',
    environment: 'specific cinematic real-world location with layered background depth, purposeful set details, atmospheric haze only when natural',
    lighting: 'controlled cinematic lighting such as soft side light, motivated practical light, rim light, or warm sunset light, realistic shadow falloff, no overdone neon glow',
    camera: 'professional photography or cinema still, accurate lens choice, controlled depth of field, refined color grade, high dynamic range without HDR artifacts',
    quality: 'cinematic but physically grounded, no fantasy anatomy, no excessive bloom, no overly polished AI texture',
  },
  anime: {
    role: 'a master anime illustrator and visual novel background artist',
    subject: 'high-quality anime character or subject, clean silhouette, expressive eyes, delicate but consistent features, readable emotion, no malformed hands',
    clothing: 'detailed anime outfit with clear material logic, controlled folds, tasteful color accents, no cluttered unreadable details',
    environment: 'beautiful Japanese illustration background, atmospheric but coherent scenery, believable perspective, detailed sky and architecture when relevant',
    lighting: 'soft anime lighting, gentle rim light, transparent shadows, vivid but controlled color palette, no blown highlights',
    camera: 'polished 2D illustration, clean linework, refined cel shading, high resolution, balanced composition',
    quality: 'avoid extra fingers, duplicated limbs, inconsistent eye direction, broken perspective, messy line artifacts',
  },
  toy: {
    role: 'an expert 3D character modeler and product photography prompt engineer',
    subject: 'cute collectible blind-box figure, chibi proportions, appealing face, clean sculpt, consistent toy anatomy, smooth resin or vinyl material',
    clothing: 'stylized outfit with readable toy-scale details, neat seams, small accessories, coherent color design',
    environment: 'minimal product photography setup, clean backdrop, simple display surface, no distracting clutter',
    lighting: 'soft studio lighting, gentle rim light, realistic ambient occlusion, controlled highlights on resin, no harsh mirror reflections',
    camera: '3D product render, macro product photography angle, sharp focus, clean composition, high-quality material rendering',
    quality: 'avoid melted toy parts, asymmetrical accidental defects, unreadable accessories, over-glossy plastic glare',
  },
}

const QUALITY_GUARDRAILS = 'single coherent image, physically plausible perspective, natural proportions, believable camera distance, realistic hands and fingers, no extra limbs, no warped joints, no broken anatomy, no duplicated face, no doll-like symmetry, no waxy skin, no plastic skin, no excessive skin roughness, no excessive smoothing, no greasy shine, no metallic reflections on skin, no over-sharpened pores, no HDR look, no surreal artifacts'

export const OMNIDRAW_FIELDS = ['subject_appearance', 'clothing_and_accessories', 'pose_and_action', 'environment_and_scene', 'lighting_and_mood', 'technical_specs', 'realism_and_quality_guardrails']
export const OMNIDRAW_ANTI_COLLAGE = 'single image, one natural coherent frame, no grid, no collage, no split screen, no multiple views'

export function createOmnidrawOptimizerPrompt(config: CharacterImageOptimizerSettings, count: number) {
  const hint = config.customPrompt.trim()
  const style = config.style === 'custom' && hint ? {
    role: `an AI prompt expert specializing in this exact style: ${hint}`,
    subject: `[${hint}] Focus on character appearance, facial details, and matching this style exactly`,
    clothing: `[${hint}] Appropriate clothing, textures, and details matching the custom style`,
    environment: `[${hint}] Background and setting matching the custom style`,
    lighting: `[${hint}] Lighting and mood matching the custom style`,
    camera: `[${hint}] Rendering style, camera specs, or art medium matching the custom style`,
    quality: `[${hint}] Keep the result coherent, physically plausible, cleanly composed, and free from common AI artifacts`,
  } : STYLE_PRESETS[config.style === 'custom' || config.style === 'follow' ? 'photo' : config.style]
  const structure = `{
  "subject_appearance": "${style.subject}",
  "clothing_and_accessories": "${style.clothing}",
  "pose_and_action": "CRITICAL: Translate the user request into English. Describe EXACTLY ONE specific pose or action. NEVER use words like various or multiple. Ensure natural interaction and physically possible body mechanics.",
  "environment_and_scene": "${style.environment}",
  "lighting_and_mood": "${style.lighting}",
  "technical_specs": "${style.camera}",
  "realism_and_quality_guardrails": "${style.quality}; ${QUALITY_GUARDRAILS}"
}`
  if (count === 1) return `You are ${style.role}.
Output ONLY ONE valid JSON object based on the user's action.
CRITICAL RULES:
1. Output MUST be a valid JSON object. ALL keys and values MUST be strings.
2. Escape any inner double quotes with a backslash (\\").
3. ALL output values MUST be written in fluent natural English. Translate any Chinese, Japanese, Korean, or mixed-language user input into English. Do not copy non-English text into the JSON.
4. ABSOLUTELY NO collages, grids, or multiple views. Describe exactly ONE single frozen moment.
5. STYLE ADHERENCE: Strictly follow the aesthetics, materials, lighting, anatomy, skin, and realism guardrails described in the output format.
6. Prefer concrete visual nouns and camera-language over abstract adjectives. Keep the prompt useful for an image model.
OUTPUT FORMAT (Use these exact keys):
${structure}`
  return `You are ${style.role}.
Generate EXACTLY ${count} distinct variations of the user's action.
CRITICAL RULES:
1. Output MUST be a valid JSON object containing a "results" array.
2. Escape any inner double quotes with a backslash (\\").
3. ALL output values MUST be written in fluent natural English. Translate any Chinese, Japanese, Korean, or mixed-language user input into English. Do not copy non-English text into the JSON.
4. ANTI-COLLAGE RULE: Each JSON object represents ONE SINGLE IMAGE. Pick exactly ONE specific pose and ONE camera angle per object.
5. STYLE ADHERENCE: Strictly follow the aesthetics, materials, lighting, anatomy, skin, and realism guardrails described in the output format.
6. Each variation must be visually distinct while remaining natural and physically plausible.

OUTPUT FORMAT:
{
  "results": [
    ${structure},
    ... (repeat ${count} times)
  ]
}`
}
