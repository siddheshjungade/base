const U200D = String.fromCharCode(8205)
const UFE0Fg = /\uFE0F/g

export function getIconCode(char: string) {
  return toCodePoint(char.indexOf(U200D) < 0 ? char.replace(UFE0Fg, "") : char)
}

function toCodePoint(unicodeSurrogates: string) {
  const r = []
  let c = 0,
    p = 0,
    i = 0

  while (i < unicodeSurrogates.length) {
    c = unicodeSurrogates.charCodeAt(i++)
    if (p) {
      r.push((65536 + ((p - 55296) << 10) + (c - 56320)).toString(16).padStart(4, "0"))
      p = 0
    } else if (55296 <= c && c <= 56319) {
      p = c
    } else {
      r.push(c.toString(16).padStart(4, "0"))
    }
  }
  return r.join("-")
}

type EmojiMap = {
  codePointToName: Record<string, string>
  nameToBase64: Record<string, string>
}

let emojimap: EmojiMap | undefined = undefined
export async function loadEmoji(code: string) {
  if (!emojimap) {
    const data = await import("./emojimap.json")
    emojimap = data
  }

  const uppercaseCode = code.toUpperCase()
  let name = emojimap.codePointToName[uppercaseCode]

  // Keycap emoji (e.g. 1️⃣) have FE0F stripped by getIconCode but the map
  // stores the full sequence (e.g. "0031-FE0F-20E3"). Try re-inserting it.
  if (!name) {
    const segments = uppercaseCode.split("-")
    for (let i = 0; i < segments.length - 1 && !name; i++) {
      const candidate = [...segments.slice(0, i + 1), "FE0F", ...segments.slice(i + 1)].join("-")
      name = emojimap.codePointToName[candidate]
    }
  }

  if (!name) {
    console.warn(`Warning: emoji codepoint ${code} not found in map, skipping`)
    return ""
  }

  const b64 = emojimap.nameToBase64[name]
  if (!b64) {
    console.warn(`Warning: emoji name ${name} not found in map, skipping`)
    return ""
  }

  return b64
}
