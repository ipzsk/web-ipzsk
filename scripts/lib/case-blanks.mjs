// 案例提示词里的「空位」写法归一化：构建期把 [自定义标题] / 【人物名称】 / {DESTINATION}
// 统统改写成 {{…}}，应用运行时只认这一种。
//
// 为什么放构建期：改写结果进 cases.manifest.json，提交时能逐行审 diff；规则错了在构建期就看得见，
// 不会变成线上每次打开页面现算的隐性行为。上游同步新案例时重跑构建脚本即可。
//
// 数据里的坑（2026-09-21 对 561 个案例实测）：
//   · 【xx】 也被拿来当小标题分段（【背景规则】），98 处。独占一行的一律不改。
//   · 提示词里有现成 JSON 片段（["胃与肠道"]、{"type":"拟声"}），带双引号的不改。
//     撇号要留——[DESCRIBE EACH PERSON'S ACTION] 是真空位。
//   · 编号小节（【1. 神格身份】）、举例与指令（[如极简、大胆]、[列举3个]）、
//     行内小标题（【画风要求】）都是结构，不是要填的东西。

const BRACKET = /[[【]([^[\]【】"\n]{1,30})[\]】]/g
const BRACE = /(?<![{\w])\{([^{}"\n:]{1,30})\}(?!\})/g
const HEADING_LINE = /^[#\-*\s]*[[【][^[\]【】]{1,30}[\]】][:：]?\s*$/
const NOT_A_BLANK = /^(\d+\s*[.、),，]|如[^果]|例如|比如|列举|参见)|(要求|规则|说明|注意事项|注意)$/
/**
 * 还有两类是「具体取值」而不是「要填的东西」，拦不住就会把发送按钮焊死：
 *   【9:16】【4:3 横版】  写死的画幅，不是让你填（带 ` / ` 的选项清单另说，那是真下拉）
 *   [静止的身体部位、影棚灯光、实心剪影]  负向提示词清单；顿号 ≥2 的都是现成清单
 */
const CONCRETE_VALUE = (inner) =>
  (!/\s\/\s/.test(inner) && /^\d+(\.\d+)?\s*[:：]\s*\d+/.test(inner))
  || ((inner.match(/、/g) ?? []).length >= 2 && !/可留空|选填|可选/.test(inner))

/** 一行里的 [xx] / 【xx】 / {xx} → {{xx}}；已经是 {{}} 的不动。 */
export function normalizeBlanks(prompt) {
  return String(prompt).split('\n').map(line => {
    if (HEADING_LINE.test(line.trim())) return line
    return [BRACKET, BRACE].reduce((acc, re) =>
      acc.replace(re, (m, inner) => {
        const t = inner.trim()
        return NOT_A_BLANK.test(t) || CONCRETE_VALUE(t) ? m : `{{${t}}}`
      }), line)
  }).join('\n')
}
