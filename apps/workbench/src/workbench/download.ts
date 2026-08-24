// 浏览器侧落文件的唯一入口。地址用完即撤，不留对象 URL。
export function triggerDownload(content: Blob, fileName: string): void {
  const url = URL.createObjectURL(content);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
