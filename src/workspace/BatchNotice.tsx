export interface OpenFailure {
  path: string;
  message: string;
}
export default function BatchNotice({
  failures,
  onClose,
}: {
  failures: OpenFailure[];
  onClose(): void;
}) {
  return (
    <div className="batch-notice" role="alert">
      <details>
        <summary>{failures.length} 个文件未能打开</summary>
        <ul>
          {failures.map((item, index) => (
            <li key={`${item.path}-${index}`}>
              <strong>{item.path}</strong>
              <span>{item.message}</span>
            </li>
          ))}
        </ul>
      </details>
      <button onClick={onClose} aria-label="关闭批量打开提示">
        关闭
      </button>
    </div>
  );
}
