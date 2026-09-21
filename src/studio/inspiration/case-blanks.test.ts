import { describe, expect, it } from 'vitest'
// 构建期的空位归一化（scripts/lib/case-blanks.mjs）：把案例原始的三种写法改写成 {{…}}。
// 规则跑在 561 个真实案例上，这里钉住那些实测踩过的坑。
import { normalizeBlanks } from '../../../scripts/lib/case-blanks.mjs'

describe('案例空位归一化', () => {
  it('三种写法都改写成 {{}}，已经是 {{}} 的不动', () => {
    expect(normalizeBlanks('标题 [自定义标题]，人物 【人物名称】，去 {DESTINATION}'))
      .toBe('标题 {{自定义标题}}，人物 {{人物名称}}，去 {{DESTINATION}}')
    expect(normalizeBlanks('已有 {{主题词}} 不动')).toBe('已有 {{主题词}} 不动')
    // 撇号不能当 JSON 引号排掉（真案例里就有这条）；注意要带上下文——整行只有一个括号会被当小标题
    expect(normalizeBlanks("动作：[DESCRIBE EACH PERSON'S ACTION]")).toBe("动作：{{DESCRIBE EACH PERSON'S ACTION}}")
  })

  it('独占一行的【小标题】不改：案例里 98 处拿它分段', () => {
    expect(normalizeBlanks('【背景规则】\n背景要干净。')).toBe('【背景规则】\n背景要干净。')
    expect(normalizeBlanks('# 【画风质感】：')).toBe('# 【画风质感】：')
    expect(normalizeBlanks('行内的【主题】要填')).toBe('行内的{{主题}}要填')
  })

  it('JSON 片段、编号小节、举例指令都不是空位', () => {
    expect(normalizeBlanks('输出 ["胃与肠道"]')).toBe('输出 ["胃与肠道"]')
    expect(normalizeBlanks('{"type": "拟声"}')).toBe('{"type": "拟声"}')
    expect(normalizeBlanks('【1. 神格身份】')).toBe('【1. 神格身份】')
    expect(normalizeBlanks('[列举3个] 和 [如极简、大胆]')).toBe('[列举3个] 和 [如极简、大胆]')
    expect(normalizeBlanks('权重 [0.30, 0.25]')).toBe('权重 [0.30, 0.25]')
    expect(normalizeBlanks('看 【画风要求】 这里')).toBe('看 【画风要求】 这里')
  })
})
