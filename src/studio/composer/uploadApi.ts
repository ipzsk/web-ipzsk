// One upload adapter for the whole studio (composer slots, subject editor, assets view): uploads land in the same asset library,
// real or mock (`?mock=1` → the assets view's IndexedDB mock store), so 「从素材选择」 and the assets grid see them.
export { uploadApi } from '../assets/api'
