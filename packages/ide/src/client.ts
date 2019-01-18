import { field, logger, time, Time } from "@coder/logger";
import { InitData } from "@coder/protocol";
import { retry, Retry } from "./retry";
import { client } from "./fill/client";
import { Clipboard, clipboard } from "./fill/clipboard";

export interface IURI {

	readonly path: string;
	readonly fsPath: string;
	readonly scheme: string;

}

export interface IURIFactory {

	/**
	 * Convert the object to an instance of a real URI.
	 */
	create<T extends IURI>(uri: IURI): T;
	file(path: string): IURI;
	parse(raw: string): IURI;

}

/**
 * A general abstraction of an IDE client.
 *
 * Everything the client provides is asynchronous so you can wait on what
 * you need from it without blocking anything else.
 *
 * It also provides task management to help asynchronously load and time code.
 */
export abstract class Client {

	public readonly retry: Retry = retry;
	public readonly clipboard: Clipboard = clipboard;
	public readonly uriFactory: IURIFactory;
	private start: Time | undefined;
	private readonly progressElement: HTMLElement | undefined;
	private tasks: string[] = [];
	private finishedTaskCount = 0;
	private readonly loadTime: Time;

	public constructor() {
		logger.info("Loading IDE");

		this.loadTime = time(2500);

		const overlay = document.getElementById("overlay");
		const logo = document.getElementById("logo");
		const msgElement = overlay
			? overlay.querySelector(".message") as HTMLElement
			: undefined;

		if (overlay && logo) {
			overlay.addEventListener("mousemove", (event) => {
				const xPos = ((event.clientX - logo.offsetLeft) / 24).toFixed(2);
				const yPos = ((logo.offsetTop - event.clientY) / 24).toFixed(2);

				logo.style.transform = `perspective(200px) rotateX(${yPos}deg) rotateY(${xPos}deg)`;
			});
		}

		this.progressElement = typeof document !== "undefined"
			? document.querySelector("#fill") as HTMLElement
			: undefined;

		require("path").posix = require("path");

		window.addEventListener("contextmenu", (event) => {
			event.preventDefault();
		});

		// Prevent Firefox from trying to reconnect when the page unloads.
		window.addEventListener("unload", () => {
			this.retry.block();
			logger.info("Unloaded");
		});

		this.uriFactory = this.createUriFactory();

		this.initialize().then(() => {
			if (overlay) {
				overlay.style.opacity = "0";
				overlay.addEventListener("transitionend", () => {
					overlay.remove();
				});
			}
			logger.info("Load completed", field("duration", this.loadTime));
		}).catch((error) => {
			logger.error(error.message);
			if (overlay) {
				overlay.classList.add("error");
			}
			if (msgElement) {
				const button = document.createElement("div");
				button.className = "reload-button";
				button.innerText = "Reload";
				button.addEventListener("click", () => {
					location.reload();
				});
				msgElement.innerText = `Failed to load: ${error.message}.`;
				msgElement.parentElement!.appendChild(button);
			}
			logger.warn("Load completed with errors", field("duration", this.loadTime));
		});
	}

	/**
	 * Wrap a task in some logging, timing, and progress updates. Can optionally
	 * wait on other tasks which won't count towards this task's time.
	 */
	public async task<T>(description: string, duration: number, task: () => Promise<T>): Promise<T>;
	public async task<T, V>(description: string, duration: number, task: (v: V) => Promise<T>, t: Promise<V>): Promise<T>;
	public async task<T, V1, V2>(description: string, duration: number, task: (v1: V1, v2: V2) => Promise<T>, t1: Promise<V1>, t2: Promise<V2>): Promise<T>;
	public async task<T, V1, V2, V3>(description: string, duration: number, task: (v1: V1, v2: V2, v3: V3) => Promise<T>, t1: Promise<V1>, t2: Promise<V2>, t3: Promise<V3>): Promise<T>;
	public async task<T, V1, V2, V3, V4>(description: string, duration: number, task: (v1: V1, v2: V2, v3: V3, v4: V4) => Promise<T>, t1: Promise<V1>, t2: Promise<V2>, t3: Promise<V3>, t4: Promise<V4>): Promise<T>;
	public async task<T, V1, V2, V3, V4, V5>(description: string, duration: number, task: (v1: V1, v2: V2, v3: V3, v4: V4, v5: V5) => Promise<T>, t1: Promise<V1>, t2: Promise<V2>, t3: Promise<V3>, t4: Promise<V4>, t5: Promise<V5>): Promise<T>;
	public async task<T, V1, V2, V3, V4, V5, V6>(description: string, duration: number, task: (v1: V1, v2: V2, v3: V3, v4: V4, v5: V5, v6: V6) => Promise<T>, t1: Promise<V1>, t2: Promise<V2>, t3: Promise<V3>, t4: Promise<V4>, t5: Promise<V5>, t6: Promise<V6>): Promise<T>;
	public async task<T>(
		description: string, duration: number = 100, task: (...args: any[]) => Promise<T>, ...after: Array<Promise<any>> // tslint:disable-line no-any
	): Promise<T> {
		this.tasks.push(description);
		if (!this.start) {
			this.start = time(1000);
		}
		const updateProgress = (): void => {
			if (this.progressElement) {
				this.progressElement.style.width = `${Math.round((this.finishedTaskCount / (this.tasks.length + this.finishedTaskCount)) * 100)}%`;
			}
		};
		updateProgress();

		let start: Time | undefined;
		try {
			const waitFor = await (after && after.length > 0 ? Promise.all(after) : Promise.resolve([]));
			start = time(duration);
			logger.info(description);
			const value = await task(...waitFor);
			logger.info(`Finished "${description}"`, field("duration", start));
			const index = this.tasks.indexOf(description);
			if (index !== -1) {
				this.tasks.splice(index, 1);
			}
			++this.finishedTaskCount;
			updateProgress();
			if (this.tasks.length === 0) {
				logger.info("Finished all queued tasks", field("duration", this.start), field("count", this.finishedTaskCount));
				this.start = undefined;
			}

			return value;
		} catch (error) {
			logger.error(`Failed "${description}"`, field("duration", typeof start !== "undefined" ? start : "not started"), field("error", error));
			if (this.progressElement) {
				this.progressElement.style.backgroundColor = "red";
			}
			throw error;
		}
	}

	/**
	 * A promise that resolves with initialization data.
	 */
	public get initData(): Promise<InitData> {
		return client.initData;
	}

	/**
	 * Initialize the IDE.
	 */
	protected abstract initialize(): Promise<void>;

	/**
	 * Create URI factory.
	 */
	protected abstract createUriFactory(): IURIFactory;

}