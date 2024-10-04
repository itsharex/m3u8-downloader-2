import { IpcMainEvent } from "electron/main";
import { inject, injectable } from "inversify";
import { handle, videoPattern } from "../helper/index.ts";
import {
  type Controller,
  DownloadItem,
  DownloadItemPagination,
  Task,
  DownloadStatus,
  VideoStat,
  ListPagination,
} from "../interfaces.ts";
import { TYPES } from "../types.ts";
import MainWindow from "../windows/MainWindow.ts";
import ElectronStore from "../vendor/ElectronStore.ts";
import DownloadService from "../services/DownloadService.ts";
import VideoRepository from "../repository/VideoRepository.ts";
import WebviewService from "../services/WebviewService.ts";
import path from "path";
import { glob } from "glob";

@injectable()
export default class DownloadController implements Controller {
  constructor(
    @inject(TYPES.ElectronStore)
    private readonly store: ElectronStore,
    @inject(TYPES.VideoRepository)
    private readonly videoRepository: VideoRepository,
    @inject(TYPES.DownloadService)
    private readonly downloadService: DownloadService,
    @inject(TYPES.MainWindow)
    private readonly mainWindow: MainWindow,
    @inject(TYPES.WebviewService)
    private readonly webviewService: WebviewService,
  ) {}

  @handle("show-download-dialog")
  async showDownloadDialog(e: IpcMainEvent, data: DownloadItem) {
    const image = await this.webviewService.captureView();
    this.webviewService.sendToWindow(
      "show-download-dialog",
      data,
      image?.toDataURL(),
    );
  }

  @handle("add-download-item")
  async addDownloadItem(e: IpcMainEvent, video: Omit<DownloadItem, "id">) {
    const item = await this.videoRepository.addVideo(video);
    // 这里向页面发送消息，通知页面更新
    this.mainWindow.send("download-item-notifier", item);
    return item;
  }

  @handle("add-download-items")
  async addDownloadItems(e: IpcMainEvent, videos: Omit<DownloadItem, "id">[]) {
    const items = await this.videoRepository.addVideos(videos);
    // 这里向页面发送消息，通知页面更新
    this.mainWindow.send("download-item-notifier", items);
    return items;
  }

  @handle("edit-download-item")
  async editDownloadItem(e: IpcMainEvent, video: DownloadItem) {
    const item = await this.videoRepository.editVideo(video);
    return item;
  }

  @handle("edit-download-now")
  async editDownloadNow(e: IpcMainEvent, video: DownloadItem) {
    const item = await this.editDownloadItem(e, video);
    await this.startDownload(e, item.id);
    return item;
  }

  @handle("download-now")
  async downloadNow(e: IpcMainEvent, video: Omit<DownloadItem, "id">) {
    // 添加下载项
    const item = await this.addDownloadItem(e, video);
    // 开始下载
    await this.startDownload(e, item.id);
    return item;
  }

  @handle("download-items-now")
  async downloadItemsNow(e: IpcMainEvent, videos: Omit<DownloadItem, "id">[]) {
    // 添加下载项
    const items = await this.addDownloadItems(e, videos);
    // 开始下载
    items.forEach((item) => this.startDownload(e, item.id));
    return items;
  }

  @handle("get-download-items")
  async getDownloadItems(
    e: IpcMainEvent,
    pagination: DownloadItemPagination,
  ): Promise<ListPagination> {
    const videos = await this.videoRepository.findVideos(pagination);

    const result: ListPagination = {
      total: videos.total,
      list: [],
    };

    const local = this.store.get("local");
    for (const video of videos.list) {
      const final: VideoStat = { ...video };
      if (video.status === DownloadStatus.Success) {
        const pattern = path.join(local, `${video.name}.{${videoPattern}}`);
        const files = await glob(pattern);
        final.exists = files.length > 0;
        final.file = files[0];
      }
      result.list.push(final);
    }

    return result;
  }

  @handle("start-download")
  async startDownload(e: IpcMainEvent, vid: number) {
    // 查找将要下载的视频
    const video = await this.videoRepository.findVideo(vid);
    const { name, url, headers, type, folder } = video;
    const local = this.store.get("local");

    // 从配置中添加参数
    const deleteSegments = this.store.get("deleteSegments");

    const task: Task = {
      id: vid,
      params: {
        url,
        type,
        local,
        name,
        headers,
        deleteSegments,
        folder,
      },
    };
    await this.videoRepository.changeVideoStatus(vid, DownloadStatus.Watting);
    this.downloadService.addTask(task);
  }

  @handle("stop-download")
  async stopDownload(e: IpcMainEvent, id: number) {
    this.downloadService.stopTask(id);
  }

  @handle("delete-download-item")
  async deleteDownloadItem(e: IpcMainEvent, id: number) {
    return await this.videoRepository.deleteDownloadItem(id);
  }
}
