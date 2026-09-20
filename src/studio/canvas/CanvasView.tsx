import { useParams } from 'react-router'
import { useCanvasAddListener } from './CanvasAddReceiver'
import { Editor } from './Editor'
import { ProjectList } from './ProjectList'

export { useCanvasAddListener } from './CanvasAddReceiver'

export function CanvasView() {
  const { projectId } = useParams()
  const canvasAdd = useCanvasAddListener()
  return <>{projectId ? <Editor key={projectId} projectId={projectId} /> : <ProjectList />}{canvasAdd}</>
}
