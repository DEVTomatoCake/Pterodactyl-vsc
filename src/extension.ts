"use strict";

import * as vscode from "vscode"

let secrets: vscode.SecretStorage | undefined
let state: vscode.Memento | undefined
let serverApiUrl = ""
let isRegistered = false

let outputChannel: vscode.OutputChannel
const log = (message: any): void => {
	outputChannel.appendLine(message)
	console.log(message)
}

export function activate(context: vscode.ExtensionContext) {
	secrets = context.secrets
	state = context.globalState

	context.subscriptions.push(
		outputChannel = vscode.window.createOutputChannel("Pterodactyl")
	)
	//outputChannel.hide()
	log("Loading extension...")

	context.subscriptions.push(vscode.workspace.registerFileSystemProvider("pterodactyl", new PterodactylFileSystemProvider(), { isCaseSensitive: true }))
	isRegistered = true
	log("Registered Pterodactyl file system provider")

	/*let initialized = false
	context.subscriptions.push(vscode.commands.registerCommand("pterodactyl.reset", _ => {
		for (const [name] of memFs.readDirectory(vscode.Uri.parse("pterodactyl:/"))) {
			memFs.delete(vscode.Uri.parse("pterodactyl:/" + name))
		}
		initialized = false
	}))

	context.subscriptions.push(vscode.commands.registerCommand("pterodactyl.deleteFile", _ => {
		if (initialized) {
			memFs.delete(vscode.Uri.parse("pterodactyl:/file.txt"))
		}
	}))

	context.subscriptions.push(vscode.commands.registerCommand("pterodactyl.init", _ => {
		if (initialized) return
		initialized = true

		memFs.createDirectory(vscode.Uri.parse("pterodactyl:/folder/"))
		memFs.writeFile(vscode.Uri.parse("pterodactyl:/file.html"), Buffer.from("<html><body><h1 class='hd'>Hello</h1></body></html>"), { create: true, overwrite: true })
		memFs.writeFile(vscode.Uri.parse("pterodactyl:/file.js"), Buffer.from("console.log('JavaScript')"), { create: true, overwrite: true })
		memFs.writeFile(vscode.Uri.parse("pterodactyl:/file.json"), Buffer.from("{ \"json\": true }"), { create: true, overwrite: true })
		memFs.writeFile(vscode.Uri.parse("pterodactyl:/folder/file.ts"), Buffer.from("let a:number = true console.log(a)"), { create: true, overwrite: true })
	}))*/

	context.subscriptions.push(vscode.commands.registerCommand("pterodactyl.init", _ => {
		addPanel()
	}))

	context.subscriptions.push(vscode.commands.registerCommand("pterodactyl.reset", _ => {
		vscode.workspace.updateWorkspaceFolders(0, vscode.workspace.workspaceFolders?.length || 0)

		state?.update("panelUrl", undefined)
		state?.update("serverId", undefined)

		serverApiUrl = ""
		secrets?.delete(serverApiUrl)

		log("Reset workspace")
	}))
}

// Modified by TompatoCake from https://github.com/kowd/vscode-webdav/blob/12a5f44d60ccf81430d70f3e50b04259524a403f/src/extension.ts#L147
function validatePanelURL(value: string): string | undefined {
	if (value) {
		try {
			let uri = vscode.Uri.parse(value.trim())
			if (!["http", "https"].some(s => s == uri.scheme.toLowerCase())) return `Unsupported protocol: ${uri.scheme}`
		} catch {
			return "Enter a valid URI"
		}
	} else return "Enter a valid URI"
}

async function addPanel() {
	/*const url = await vscode.window.showInputBox({
		prompt: "Enter the Pterodactyl panel URL",
		placeHolder: "Enter the main Pterodactyl panel URL here...",
		validateInput: validatePanelURL
	})
	if (!url || validatePanelURL(url)) return*/
	const url = "https://panel.chaoshosting.eu/server/49283264"

	let panelUrl = vscode.Uri.parse(url.trim())

	const apiKey = await vscode.window.showInputBox({
		prompt: "Enter your Pterodactyl API key",
		placeHolder: "Enter your Pterodactyl API key here...",
		password: true
	})
	if (!apiKey || apiKey.length != 48) return vscode.window.showErrorMessage("Invalid API key, must be 48 characters long")

	const req = await fetch(panelUrl.scheme + "://" + panelUrl.authority + "/api/client/", {
		headers: {
			Accept: "application/json",
			Authorization: "Bearer " + apiKey
		}
	})
	if (!req.ok) return vscode.window.showErrorMessage("Failed to connect to the Pterodactyl panel: " + req.status + " " + req.statusText)

	let json: any = {}
	try {
		json = await req.json()
	} catch (e) {
		return vscode.window.showErrorMessage("Failed to connect to the Pterodactyl panel: " + e)
	}
	secrets?.store(panelUrl.scheme + panelUrl.authority, apiKey)

	const serverId: any = await vscode.window.showQuickPick(json.data.map((server: any) => ({
		label: server.attributes.name,
		description: server.attributes.identifier,
		detail: server.attributes.description
	})), {
		placeHolder: "Select a server to load into VS Code..."
	})
	if (!serverId) return

	serverApiUrl = panelUrl.scheme + "://" + panelUrl.authority + "/api/client/servers/" + serverId.description + "/files"
	log("Setting server API URL to " + serverApiUrl)

	if (!isRegistered) {
		vscode.workspace.registerFileSystemProvider("pterodactyl", new PterodactylFileSystemProvider(), { isCaseSensitive: true })
		isRegistered = true
		log("Force registered Pterodactyl file system provider")
	}

	log("Opening " + vscode.Uri.parse("pterodactyl:/" + serverId.description))
	vscode.workspace.updateWorkspaceFolders(0, 0, {
		uri: vscode.Uri.parse("pterodactyl:/" + serverId.description),
		name: "Pterodactyl - " + json.data.find((server: any) => server.attributes.identifier == serverId.description)?.attributes.name
	})

	state?.update("panelUrl", panelUrl.scheme + "://" + panelUrl.authority)
	state?.update("serverId", serverId.description)
}

export class PterodactylFileSystemProvider implements vscode.FileSystemProvider {

	private readonly _eventEmitter: vscode.EventEmitter<vscode.FileChangeEvent[]>

	public constructor() {
		this._eventEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
		this.onDidChangeFile = this._eventEmitter.event
	}

	public readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>

	private forConnection(operation: string, res: Response): void {
		log(operation + ": " + res.status + " " + res.statusText)
		switch (res.status) {
			case 401:
				vscode.window.showWarningMessage(`Authentication failed for ${vscode.Uri.parse(serverApiUrl).authority}.`, "Authenticate")
				throw vscode.FileSystemError.NoPermissions(res.url)
			case 403:
				throw vscode.FileSystemError.NoPermissions(res.url)
			case 404:
				throw vscode.FileSystemError.FileNotFound(res.url)
		}
	}

	public async copy(source: vscode.Uri, destination: vscode.Uri): Promise<void> {
		const copyRes = await fetch(serverApiUrl + "/copy", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer " + secrets?.get(serverApiUrl)
			},
			body: JSON.stringify({
				location: source.path
			})
		})
		if (!copyRes.ok) throw await copyRes.json()
		this.forConnection("copy: " + source.path + " -> " + destination.path, copyRes)

		const renameRes = await fetch(serverApiUrl + "/rename", {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer " + secrets?.get(serverApiUrl)
			},
			body: JSON.stringify({
				root: "/",
				files: [{
					from: source.path + " copy",
					to: destination.path
				}]
			})
		})
		if (!renameRes.ok) throw await renameRes.json()

		this.forConnection("rename after copy: " + source.path + " -> " + destination.path, renameRes)
	}

	public async createDirectory(uri: vscode.Uri): Promise<void> {
		const res = await fetch(serverApiUrl + "/create-folder", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer " + secrets?.get(serverApiUrl)
			},
			body: JSON.stringify({
				root: "/",
				folders: [uri.path]
			})
		})
		this.forConnection("createDirectory: " + uri, res)
	}

	public async delete(uri: vscode.Uri): Promise<void> {
		const res = await fetch(serverApiUrl + "/delete", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer " + secrets?.get(serverApiUrl)
			},
			body: JSON.stringify({
				root: "/",
				files: [uri.path]
			})
		})
		this.forConnection("delete: " + uri, res)
	}

	public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		const res = await fetch(serverApiUrl + "/list?directory=" + encodeURIComponent(uri.path), {
			headers: {
				Authorization: "Bearer " + secrets?.get(serverApiUrl),
				Accept: "application/json"
			}
		})
		this.forConnection("readDirectory: " + uri, res)

		const json: any = await res.json()
		return json.data.map((file: any) => [
			file.name,
			file.is_file ?
				(file.is_symlink ? vscode.FileType.File | vscode.FileType.SymbolicLink : vscode.FileType.File) :
				(file.is_symlink ? vscode.FileType.Directory | vscode.FileType.SymbolicLink : vscode.FileType.Directory)
		])
	}

	public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		const res = await fetch(serverApiUrl + "/contents?file=" + encodeURIComponent(uri.path), {
			headers: {
				Authorization: "Bearer " + secrets?.get(serverApiUrl)
			}
		})
		this.forConnection("readFile: " + uri, res)

		// @ts-ignore
		return res.body
	}

	public async rename(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<void> {
		const res = await fetch(serverApiUrl + "/rename", {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer " + secrets?.get(serverApiUrl)
			},
			body: JSON.stringify({
				root: "/",
				files: [{
					from: oldUri.path,
					to: newUri.path
				}]
			})
		})
		this.forConnection("rename: " + oldUri + " -> " + newUri, res)
	}

	public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		const res = await fetch(serverApiUrl + "/list?directory=" + encodeURIComponent(uri.path), {
			headers: {
				Authorization: "Bearer " + secrets?.get(serverApiUrl),
				Accept: "application/json"
			}
		})
		this.forConnection("stat: " + uri, res)

		const json: any = await res.json()
		log(json)
		const file = json.data.find((file: any) => file.name == uri.path.split("/").pop()).attributes
		log(file)

		return {
			ctime: file.created_at,
			mtime: file.modified_at,
			permissions: file.is_editable ? void 0 : vscode.FilePermission.Readonly,
			size: file.size,
			type: file.is_file
				? (file.is_symlink ? vscode.FileType.File | vscode.FileType.SymbolicLink : vscode.FileType.File)
				: (file.is_symlink ? vscode.FileType.Directory | vscode.FileType.SymbolicLink : vscode.FileType.Directory)
		}
	}

	public watch(): vscode.Disposable {
		return { dispose: () => { } }
	}

	public async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): Promise<void> {
		try {
			let stat = await this.stat(uri)
			if (stat.type == vscode.FileType.Directory) throw vscode.FileSystemError.FileIsADirectory(uri)

			if (!options.overwrite) throw vscode.FileSystemError.FileExists(uri)
		} catch {
			if (!options.create) throw vscode.FileSystemError.FileNotFound(uri)
		}

		const res = await fetch(serverApiUrl + "/write?file=" + uri.path, {
			method: "POST",
			headers: {
				Authorization: "Bearer " + secrets?.get(serverApiUrl)
			},
			body: content
		})
		this.forConnection("writeFile: " + uri, res)
	}
}
