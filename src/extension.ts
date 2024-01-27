"use strict";

import * as vscode from "vscode"

let serverApiUrl = ""
let authHeader = ""

let outputChannel: vscode.OutputChannel
const log = (message: any): void => outputChannel.appendLine(message)
const proxyUrl = (url: string): string => vscode.workspace.getConfiguration("pterodactyl-vsc").get("proxyUrl") + encodeURIComponent(url)

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		outputChannel = vscode.window.createOutputChannel("Pterodactyl file system")
	)
	log("Loading extension...")

	const fsProvider = new PterodactylFileSystemProvider()
	context.subscriptions.push(vscode.workspace.registerFileSystemProvider("pterodactyl", fsProvider, { isCaseSensitive: true }))

	if (vscode.workspace.getConfiguration("pterodactyl-vsc").get("panelUrl") && vscode.workspace.getConfiguration("pterodactyl-vsc").get("serverId"))
		serverApiUrl = vscode.workspace.getConfiguration("pterodactyl-vsc").get("panelUrl") + "/api/client/servers/" + vscode.workspace.getConfiguration("pterodactyl-vsc").get("serverId") + "/files"
	if (vscode.workspace.getConfiguration("pterodactyl-vsc").get("apiKey")) authHeader = "Bearer " + vscode.workspace.getConfiguration("pterodactyl-vsc").get("apiKey")

	context.subscriptions.push(vscode.commands.registerCommand("pterodactyl-vsc.init", _ => {
		addPanel()
	}))

	context.subscriptions.push(vscode.commands.registerCommand("pterodactyl-vsc.reset", _ => {
		vscode.workspace.updateWorkspaceFolders(0, vscode.workspace.workspaceFolders?.length || 0)

		serverApiUrl = ""
		authHeader = ""

		log("Reset workspace")
	}))
}

// Modified from https://github.com/kowd/vscode-webdav/blob/12a5f44d60ccf81430d70f3e50b04259524a403f/src/extension.ts#L147
const validatePanelURL = (value: string): string | undefined => {
	if (value) {
		try {
			const uri = vscode.Uri.parse(value.trim())
			if (uri.scheme != "http" && uri.scheme != "https") return "Unsupported protocol: " + uri.scheme
		} catch {
			return "Enter a valid URL"
		}
	} else return "Enter a valid URL"
}

async function addPanel() {
	const url = await vscode.window.showInputBox({
		prompt: "Enter the Pterodactyl panel URL",
		placeHolder: "Enter a Pterodactyl panel URL here...",
		validateInput: validatePanelURL
	})
	if (!url || validatePanelURL(url)) return

	const panelUrl = vscode.Uri.parse(url.trim())

	const apiKey = await vscode.window.showInputBox({
		prompt: "Enter your Pterodactyl API key",
		placeHolder: "Enter your Pterodactyl API key here...",
		validateInput: (value: string) => value ? (value.length == 48 ? void 0 : "API keys are 48 characters long") : "Enter a valid API key",
		password: true
	})
	if (!apiKey || apiKey.length != 48) return vscode.window.showErrorMessage("Invalid API key, must be 48 characters long")

	log("Connecting to " + panelUrl.scheme + "://" + panelUrl.authority + "...")
	const req = await fetch(proxyUrl(panelUrl.scheme + "://" + panelUrl.authority + "/api/client/"), {
		headers: {
			Accept: "application/json",
			Authorization: "Bearer " + apiKey
		}
	})
	log("Connection response: " + req.status + " " + req.statusText)
	if (!req.ok) return vscode.window.showErrorMessage("Failed to connect to the Pterodactyl panel: " + req.status + " " + req.statusText)

	const json: any = await req.json()
	log(json)
	vscode.workspace.getConfiguration("pterodactyl-vsc").update("apiKey", apiKey)

	log("Connected successfully, " + json.data.length + " servers found")
	const serverId: any = await vscode.window.showQuickPick(json.data.map((server: any) => ({
		label: server.attributes.name,
		description: server.attributes.identifier,
		detail: server.attributes.description
	})), {
		placeHolder: "Select a server to load into VS Code..."
	})
	if (!serverId) return

	serverApiUrl = panelUrl.scheme + "://" + panelUrl.authority + "/api/client/servers/" + serverId.description + "/files"
	authHeader = "Bearer " + apiKey
	log("Setting server api URL & auth header to " + serverApiUrl)

	vscode.workspace.getConfiguration("pterodactyl-vsc").update("panelUrl", panelUrl.scheme + "://" + panelUrl.authority)
	vscode.workspace.getConfiguration("pterodactyl-vsc").update("serverId", serverId.description)

	vscode.workspace.updateWorkspaceFolders(0, 0, {
		uri: vscode.Uri.parse("pterodactyl:/"),
		name: "Pterodactyl - " + json.data.find((server: any) => server.attributes.identifier == serverId.description)?.attributes.name
	})
}

export class PterodactylFileSystemProvider implements vscode.FileSystemProvider {

	private readonly _eventEmitter: vscode.EventEmitter<vscode.FileChangeEvent[]>

	public constructor() {
		this._eventEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
		this.onDidChangeFile = this._eventEmitter.event
	}

	public readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>

	private removeStartSlash(path: string): string {
		return path.replace(/^\//, "")
	}

	private async forConnection(operation: string, res: Response): Promise<void> {
		log(operation + ": " + res.status + " " + res.statusText)
		switch (res.status) {
			case 401:
				const message = await vscode.window.showWarningMessage("Authentication failed for " + vscode.Uri.parse(serverApiUrl).authority + ".", "Authenticate")
				if (message == "Authenticate") addPanel()
				throw vscode.FileSystemError.NoPermissions(res.url)
			case 403:
				throw vscode.FileSystemError.NoPermissions(res.url)
			case 404:
				throw vscode.FileSystemError.FileNotFound(res.url)
			case 429:
				throw vscode.FileSystemError.Unavailable("You have been ratelimited by the Pterodactyl panel.")
		}
	}

	public async copy(source: vscode.Uri, destination: vscode.Uri, options: { overwrite: boolean } = { overwrite: false }): Promise<void> {
		if (options.overwrite) {
			try {
				await this.delete(destination)
			} catch {}
		}

		const copyRes = await fetch(proxyUrl(serverApiUrl + "/copy"), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: authHeader
			},
			body: JSON.stringify({
				location: source.path
			})
		})
		this.forConnection("copy: " + source.path + " -> " + destination.path, copyRes)
		if (!copyRes.ok) throw await copyRes.json()

		const oldPath = source.path.split("/").slice(0, -1).join("/") || "/"
		const oldName = source.path.split("/").pop()
		const copiedLoc = oldName?.split(".").slice(0, -1).join(".") + " copy." + oldName?.split(".").pop()
		const newPath = destination.path.split("/").slice(0, -1).join("/") || "/"
		if (oldPath == newPath) return log("copy: Not renaming file " + newPath + "/" + copiedLoc + " due to same directory")
		log("copy: " + oldPath + "/" + copiedLoc + " -> " + newPath + "/" + destination.path.split("/").pop())

		const renameRes = await fetch(proxyUrl(serverApiUrl + "/rename"), {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				Authorization: authHeader
			},
			body: JSON.stringify({
				root: "/",
				files: [{
					from: this.removeStartSlash(oldPath + "/") + copiedLoc,
					to: this.removeStartSlash(newPath + "/") + destination.path.split("/").pop()
				}]
			})
		})
		if (!renameRes.ok) throw await renameRes.json()

		this.forConnection("rename after copy: " + source.path + " -> " + destination.path, renameRes)
	}

	public async createDirectory(uri: vscode.Uri): Promise<void> {
		const res = await fetch(proxyUrl(serverApiUrl + "/create-folder"), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: authHeader
			},
			body: JSON.stringify({
				root: "/",
				name: uri.path
			})
		})
		this.forConnection("createDirectory: " + uri, res)
	}

	public async delete(uri: vscode.Uri, options: { recursive: boolean } = { recursive: true }): Promise<void> {
		if (options.recursive === false) {
			let items: any = []
			try {
				items = await this.readDirectory(uri)
			} catch {}

			if (items && items.length > 0) throw vscode.FileSystemError.Unavailable("Directory not empty")
		}

		const res = await fetch(proxyUrl(serverApiUrl + "/delete"), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: authHeader
			},
			body: JSON.stringify({
				root: "/",
				files: [this.removeStartSlash(uri.path)]
			})
		})
		this.forConnection("delete: " + uri, res)
	}

	public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		const res = await fetch(proxyUrl(serverApiUrl + "/list?directory=" + encodeURIComponent(uri.path)), {
			headers: {
				Authorization: authHeader,
				Accept: "application/json"
			}
		})
		this.forConnection("readDirectory: " + uri, res)
		if (!res.ok) {
			const json: any = await res.json()
			if (json.errors[0].code == "DaemonConnectionException") throw vscode.FileSystemError.FileNotFound(uri)
		}

		const json: any = await res.json()
		return json.data.map((file: any) => [
			file.attributes.name,
			file.attributes.is_file ?
				(file.attributes.is_symlink ? vscode.FileType.File | vscode.FileType.SymbolicLink : vscode.FileType.File) :
				(file.attributes.is_symlink ? vscode.FileType.Directory | vscode.FileType.SymbolicLink : vscode.FileType.Directory)
		])
	}

	public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		const res = await fetch(proxyUrl(serverApiUrl + "/contents?file=" + encodeURIComponent(uri.path)), {
			headers: {
				Authorization: authHeader
			}
		})
		this.forConnection("readFile: " + uri, res)
		if (!res.ok) throw vscode.FileSystemError.FileNotFound(uri)

		return new Uint8Array(await res.arrayBuffer())
	}

	public async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean } = { overwrite: false }): Promise<void> {
		if (options.overwrite) {
			try {
				await this.delete(newUri)
			} catch {}
		}

		const res = await fetch(proxyUrl(serverApiUrl + "/rename"), {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				Authorization: authHeader
			},
			body: JSON.stringify({
				root: "/",
				files: [{
					from: this.removeStartSlash(oldUri.path),
					to: this.removeStartSlash(newUri.path)
				}]
			})
		})
		this.forConnection("rename: " + oldUri + " -> " + newUri, res)
	}

	public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		if (uri.path == "/") return {
			ctime: 0,
			mtime: 0,
			size: 0,
			type: vscode.FileType.Directory
		}

		const folderPath = uri.path.split("/").slice(0, -1).join("/") || "/"
		const res = await fetch(proxyUrl(serverApiUrl + "/list?directory=" + encodeURIComponent(folderPath)), {
			headers: {
				Authorization: authHeader,
				Accept: "application/json"
			}
		})
		this.forConnection("stat: " + uri, res)

		const json: any = await res.json()
		if (!res.ok) {
			if (json.errors[0].code == "DaemonConnectionException") throw vscode.FileSystemError.FileNotFound(uri)
			throw vscode.FileSystemError.Unavailable(json.errors[0].detail)
		}

		const file = json.data.find((file: any) => file.attributes.name == uri.path.split("/").pop())?.attributes
		if (!file) throw vscode.FileSystemError.FileNotFound(uri)

		return {
			ctime: new Date(file.created_at).getTime(),
			mtime: new Date(file.modified_at).getTime(),
			permissions: file.mode[2] == "w" ? void 0 : vscode.FilePermission.Readonly,
			size: file.size,
			type: file.is_file
				? (file.is_symlink ? vscode.FileType.File | vscode.FileType.SymbolicLink : vscode.FileType.File)
				: (file.is_symlink ? vscode.FileType.Directory | vscode.FileType.SymbolicLink : vscode.FileType.Directory)
		}
	}

	public async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): Promise<void> {
		try {
			let stat = await this.stat(uri)
			if (stat.type == vscode.FileType.Directory) throw vscode.FileSystemError.FileIsADirectory(uri)

			if (!options.overwrite) throw vscode.FileSystemError.FileExists(uri)
		} catch {
			if (!options.create) throw vscode.FileSystemError.FileNotFound(uri)
		}

		const res = await fetch(proxyUrl(serverApiUrl + "/write?file=" + uri.path), {
			method: "POST",
			headers: {
				Authorization: authHeader
			},
			body: content
		})
		this.forConnection("writeFile: " + uri, res)
	}

	public watch(): vscode.Disposable {
		return {
			dispose: () => {}
		}
	}
}
