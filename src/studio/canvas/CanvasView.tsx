import { useParams } from 'react-router'
import { Editor } from './Editor'
import { ProjectList } from './ProjectList'

export function CanvasView() {
  const { projectId } = useParams()
  return projectId ? <Editor key={projectId} projectId={projectId} /> : <ProjectList />
}
