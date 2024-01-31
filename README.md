# Pterodactyl server files in VS Code

## Usage

1. Install the extension from the [marketplace](https://marketplace.visualstudio.com/items?itemName=tomatocake.pterodactyl-vsc) or as VSIX by building it yourself, or by downloading it from the [releases page](https://github.com/DEVTomatoCake/Pterodactyl-vsc/releases).
2. Open the command palette (default: `Ctrl + Shift + P`) and run `Pterodactyl: Connect to server`.
3. Enter the panel URL and your client (not application) API key from Account Settings -> API Credentials.
4. Select the server you want to edit the files of.
5. Done!

## Configuration

- `pterodactyl-vsc.panelUrl`: The URL of the Pterodactyl panel.
- `pterodactyl-vsc.serverId`: Server ID of the server you want to edit the files of, found in the URL of the server's page.
- `pterodactyl-vsc.apiKey`: Client API key of the server you want to edit the files of.
- `pterodactyl-vsc.proxyUrl`: The proxy URL used to circumvent CORS blocking requests to the panel. Leave it at the default value unless you know what you're doing. See [CORS Proxy](#cors-proxy) for more information.

## CORS Proxy

By default the extension uses the proxy URL `https://pterodactyl-vsc.tomatocake.workers.dev/?url=`.
The proxy was created by me to circumvent CORS blocking requests to the panel.

There are several options available if you don't want to use the default proxy:
1. Use your own proxy using the following [Cloudflare worker](https://workers.cloudflare.com) code:
```js
export default {
	async fetch(request) {
		if (request.method == "OPTIONS") return new Response(void 0, {
			status: 204,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Headers": "authorization, content-type, accept"
			}
		})
		if (request.method != "GET" && request.method != "POST") return new Response(void 0, {
			status: 405
		})

		const proxyUrl = new URL(request.url).searchParams.get("url")
		if (!proxyUrl) return new Response("Missing url param", { status: 400 })

		let res = await fetch(proxyUrl, request)

		if (request.headers.has("Origin")) {
			res = new Response(res.body, res)
			res.headers.set("Access-Control-Allow-Origin", "*")
			res.headers.set("Access-Control-Allow-Credentials", "true")
		}

		return res
	}
}
```

2. If you have access to the domain owning the panel, you can overwrite CORS headers to the panel's responses, e.g. using Cloudflare Transform Rules:
> [!CAUTION]
> This will allow any website to access the panel's API using the credentials of the user who's logged in to the panel. If possible, replace `*` with the hostname of the website the extension is mainly used on, e.g. `vscode.dev`.

- Open the "Transform Rules" tab of your domain and create a new response header overwrite.
- Select "Custom filter".
- Select "Hostname" and enter the hostname (e.g. panel.example.com) of your panel.
- Select URI path with "Starts with" and enter `/api/client/servers/`.
- Add a new static response header with the key `Access-Control-Allow-Origin` and the value `*`.

3. If you want to build the extension yourself and you're only using it locally in the VS Code Desktop app, you can disable the web build of it by removing the `browser` field in the package.json. This works because only the web build has to use the JS Fetch API, which is affected by CORS.

## Credits

- Base from [microsoft/vscode-extension-samples](https://github.com/microsoft/vscode-extension-samples/tree/main/fsprovider-sample)
- Most of the logic from [kowd/vscode-webdav](https://github.com/kowd/vscode-webdav)
