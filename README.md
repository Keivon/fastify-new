# fastify-new
Answer a few prompts, get a custom fastify app in seconds.

## Use as `fastify-new`

### Local development

```bash
sudo npm install --save-dev typescript tsx @types/node

npx tsc

npm run postbuild

npm link

fastify-new my-app
```

### Global install

```bash
npm install -g .
fastify-new my-app
```

### Plugin scaffold step

During generation, the CLI shows this menu and repeats it until you choose `Done`:

1. Route
2. Hook
3. Decorator
4. Child plugin
5. Done

After finishing one plugin, the CLI asks if you want to scaffold another plugin.

When you select any add option, the CLI prompts for a plugin name (no default value).
When you select `Child plugin`, the CLI also prompts for the child plugin name.
When you select `Route`, the CLI asks for a route name and generates it at `plugins/<plugin>/routes/<route-name>/index.js` with endpoint prefix `/<route-name>`.
You can add multiple routes and multiple hooks per plugin; names must be unique within that plugin.

### Troubleshooting (Linux/macOS)

```bash
chmod +x cli.js
npm link
```
