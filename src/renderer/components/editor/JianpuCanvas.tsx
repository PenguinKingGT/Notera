/** Display read-only numbered notation from the current musical snapshot, sharing vector pages with PDF export. */
import type { Score } from '../../../core'
import type { JianpuResponse } from '../../../jianpu/protocol'

/** Render independent pages without binding editing handlers or accepting arbitrary external SVG. */
export function JianpuCanvas({
  score,
  response,
  pending,
}: {
  score: Score
  response: JianpuResponse | null
  pending: boolean
}) {
  const pages = response && 'pages' in response ? response.pages : []
  return (
    <div
      className="score-canvas"
      data-testid="jianpu-canvas"
      tabIndex={0}
      aria-label="简谱查看区"
      aria-busy={pending}
    >
      <p className="jianpu-help">
        简谱仅供查看与导出，编辑请切换五线谱。按调号对应大调标示
        1，基准音为该音名的第 4 八度；空白为未输入内容。
      </p>
      {pages.map((svg, index) => (
        <article
          className="score-page"
          key={index}
          aria-label={`简谱第 ${index + 1} 页`}
        >
          <header className="score-paper-heading">
            <h2>{score.title || '未命名钢琴谱'}</h2>
            <p>
              钢琴简谱 · {index + 1} / {pages.length}
            </p>
          </header>
          <div
            className="notation-svg jianpu-svg"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </article>
      ))}
    </div>
  )
}
