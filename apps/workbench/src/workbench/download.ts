// 下载请求接收后再释放对象 URL，兼容异步接收文件的内嵌浏览器。
export function triggerDownload(content: Blob, fileName: string): void {
  const url = URL.createObjectURL(content);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = fileName; anchor.hidden = true;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
