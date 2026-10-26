import { describe, expect, it } from 'vitest'
import { advanceTasks, detectKind, getModelDependents, logKnowledgeIds, rechunkKnowledge, restoreChunkSource, retrieveChunks, seed, shouldReadFileContent, splitContent, validateFiles } from './workspace'

describe('knowledge ingestion', () => {
  it('recognizes all required formats and rejects unsupported data', () => {
    expect(['guide.docx', 'guide.pdf', 'guide.md', 'image.PNG', 'data.xlsx', 'data.csv'].map(detectKind)).toEqual(['Word', 'PDF', 'Markdown', '图片', '表格', '表格'])
    expect(detectKind('script.exe')).toBeNull()
  })
  it('rejects duplicate, empty and oversize files before a build starts', () => {
    const results = validateFiles([{ name: 'a.pdf', size: 100 }, { name: 'a.pdf', size: 100 }, { name: 'b.pdf', size: 0 }, { name: 'c.pdf', size: 51 * 1024 * 1024 }])
    expect(results.map((file) => Boolean(file.error))).toEqual([false, true, true, true])
  })
  it('completes documents in the submitted task without changing other knowledge bases', () => {
    const state = structuredClone(seed)
    state.tasks.push({ id: 'new', kbId: 'company-policy', fileIds: ['d5'], state: 'processing', progress: 96, created: 'now' })
    const doc = state.documents.find((d) => d.id === 'd5')!
    doc.state = 'processing'
    state.chunks.push({ id: 'test-chunk', documentId: 'd5', kbId: doc.kbId, title: 'Test', text: '采购流程', page: 1, indexed: false })
    const result = advanceTasks(state)
    expect(result.documents.find((d) => d.id === 'd5')?.state).toBe('ready')
    expect(result.documents.find((d) => d.id === 'd5')?.chunks).toBeGreaterThan(0)
    expect(result.documents.find((d) => d.id === 'p1')).toEqual(state.documents.find((d) => d.id === 'p1'))
    expect(doc.state).toBe('processing')
  })
  it('preserves overlap and rejects invalid chunk sizes', () => {
    expect(splitContent('abcdefghij', 5, 2)).toEqual(['abcde', 'defgh', 'ghij'])
    expect(() => splitContent('text', 5, 5)).toThrow()
  })
  it('changes chunk boundaries and marks rebuilt content pending', () => {
    const state = structuredClone(seed)
    const result = rechunkKnowledge(state, 'cuisine', 100, 10)
    expect(result.chunks.filter((c) => c.kbId === 'cuisine').every((c) => c.text.length <= 100 && !c.indexed)).toBe(true)
    expect(result.chunks.filter((c) => c.kbId === 'company-policy')).toEqual(state.chunks.filter((c) => c.kbId === 'company-policy'))
  })
  it('does not re-index edited chunks because an older task was complete', () => {
    const state = structuredClone(seed)
    state.chunks[0].indexed = false
    state.tasks.push({ id: 'old', kbId: 'cuisine', fileIds: ['food-pdf'], state: 'ready', progress: 100, created: 'past' })
    state.tasks.push({ id: 'new', kbId: 'company-policy', fileIds: ['d1'], state: 'processing', progress: 8, created: 'now' })
    expect(advanceTasks(state).chunks[0].indexed).toBe(false)
  })
  it('retrieves only indexed content from the selected knowledge base', () => {
    const state = structuredClone(seed)
    expect(retrieveChunks(state, ['cuisine'], '过桥米线食材')[0].title).toBe('过桥米线')
    expect(retrieveChunks(state, ['company-policy'], '过桥米线食材')).toHaveLength(0)
    state.chunks.find((c) => c.title === '过桥米线')!.indexed = false
    expect(retrieveChunks(state, ['cuisine'], '过桥米线食材').some((c) => c.title === '过桥米线')).toBe(false)
    expect(retrieveChunks(state, ['cuisine'], '量子计算芯片')).toHaveLength(0)
  })
  it('reads Markdown and CSV only after all file validations pass', () => {
    expect(shouldReadFileContent({ name: 'guide.md', size: 100 })).toBe(true)
    expect(shouldReadFileContent({ name: 'data.csv', size: 100 })).toBe(true)
    expect(shouldReadFileContent({ name: 'large.md', size: 51 * 1024 * 1024 })).toBe(false)
    expect(shouldReadFileContent({ name: 'empty.csv', size: 0 })).toBe(false)
    expect(shouldReadFileContent({ name: 'guide.md', size: 100 }, ['guide.md'])).toBe(false)
    expect(shouldReadFileContent({ name: 'script.exe', size: 100 })).toBe(false)
  })
  it('finds every LLM, Embedding and Rerank dependency before model changes', () => {
    const state = structuredClone(seed)
    const dependents = (name: string) => getModelDependents(state, state.models.find((model) => model.name === name)!)
    expect(dependents('qwen-plus')).toHaveLength(3)
    expect(dependents('qwen-plus')[0]).toContain('问答应用')
    expect(dependents('text-embedding-v4').some((item) => item.includes('Embedding'))).toBe(true)
    expect(dependents('qwen3-rerank').some((item) => item.includes('Rerank'))).toBe(true)
    expect(dependents('gemini-flash')).toEqual([])
  })
  it('removes shared overlap before rebuilding instead of duplicating content', () => {
    const source = restoreChunkSource([{ text: 'abcde' }, { text: 'defgh' }, { text: 'ghij' }])
    expect(source).toBe('abcdefghij')
    expect(splitContent(source, 5, 2)).toEqual(['abcde', 'defgh', 'ghij'])
    expect(restoreChunkSource([{ text: '第一章' }, { text: '第二章' }])).toBe('第一章\n\n第二章')
  })
  it('keeps every knowledge source on multi-knowledge logs and supports legacy records', () => {
    expect(logKnowledgeIds({ kbId: 'legacy' })).toEqual(['legacy'])
    expect(logKnowledgeIds({ kbId: 'primary', kbIds: ['primary', 'secondary'] })).toEqual(['primary', 'secondary'])
  })
})
