import { defineKatexSetup } from '@slidev/types'

export default defineKatexSetup(() => {
  return {
    macros: {
    "\\R": "\\mathbb{R}",
    "\\colorV": "\\color{blue}",
    "\\pair": "\\langle #1, #2 \\rangle",
    },
  }
})
