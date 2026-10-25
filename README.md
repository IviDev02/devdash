# DevDash

Dashboard que reúne **tus métricas de GitHub y el estado de tus contenedores Docker en una sola vista**: actividad, lenguajes y repos por un lado; CPU, memoria, red y logs de cada contenedor en directo por otro.

**Stack:** React · Recharts · Node.js · Express · Docker Engine API · Server-Sent Events · Docker

> [!IMPORTANT]
> **Este proyecto funciona en local.** Es un proyecto personal pensado para ejecutarse en tu propio ordenador, junto a tu Docker: no hay ninguna versión desplegada en internet. Es gratis y se pone en marcha con un solo comando.
>
> **¿No tienes Docker?** No pasa nada: DevDash lo detecta y muestra **contenedores simulados** para que puedas ver cómo funciona.

## Funcionalidades

### GitHub

- **Perfil y totales**: repos públicos, estrellas y forks (sin contar forks de otros), seguidores.
- **Actividad de los últimos 30 días** en un gráfico de barras apiladas por tipo: push, pull requests, issues y otros.
- **Racha** de días seguidos con actividad y número de días activos.
- **Lenguajes** en un gráfico de donut, ponderados por el tamaño de cada repositorio.
- **Repositorios destacados** y **últimos movimientos** (push, PRs, issues, releases…) con enlaces a GitHub.
- **Cualquier usuario**: escribe otro nombre en la cabecera y el dashboard cambia al momento. Se recuerda el último que miraste.

### Docker

- **Estado en directo** de todos los contenedores (en marcha, parados, sanos o con fallos), actualizado cada 2 segundos sin recargar.
- **CPU, memoria y red** de cada contenedor, con un minigráfico de CPU por fila y un gráfico de CPU/memoria de los 5 que más consumen.
- **Arrancar, parar y reiniciar** contenedores desde el dashboard.
- **Logs** de cada contenedor en un visor con modo "seguir en directo", filtro de texto y errores/avisos resaltados.
- **Filtros y búsqueda** por nombre, imagen o proyecto de Docker Compose. Los puertos publicados son enlaces directos (`:8080` abre `localhost:8080`).

## Arquitectura

```
client/   React 19 + Vite + Recharts — SPA servida por Express
server/   Express 5, sin más dependencias en producción
          ├─ github.js      cliente de la API de GitHub con caché + ETag y cálculo de métricas
          ├─ docker.js      cliente mínimo del Docker Engine API sobre el socket local
          ├─ demoDocker.js  motor simulado con la misma interfaz, para cuando no hay Docker
          ├─ monitor.js     sondeo de métricas, histórico y difusión por Server-Sent Events
          └─ test/          tests unitarios y de integración (node:test + Supertest)
```

- **Docker sin librerías:** el servidor habla directamente con el Docker Engine API por el socket Unix (`/var/run/docker.sock`) o la *named pipe* de Windows (`//./pipe/docker_engine`) usando `node:http`. También admite `DOCKER_HOST=tcp://…`.
- **CPU como `docker stats`:** el % de CPU se calcula con la diferencia entre dos lecturas consecutivas, y la memoria descuenta la caché de ficheros (cgroup v1 y v2).
- **Logs multiplexados:** sin TTY, Docker mezcla stdout y stderr en tramas con cabecera binaria de 8 bytes; `demuxLogs` las separa.
- **Tiempo real con Server-Sent Events:** al conectar, el navegador recibe un *snapshot* con el histórico y después un *tick* cada 2 s. El servidor **solo consulta Docker mientras hay alguien mirando** y comparte una única lectura entre todas las pestañas abiertas.
- **GitHub sin agotar la cuota:** sin token, GitHub permite 60 peticiones por hora. Las respuestas se guardan en caché 5 minutos y después se revalidan con `ETag` (las respuestas `304` no cuentan para el límite). Si se agota el límite o no hay conexión, se siguen mostrando los últimos datos.
- **Modo demo intercambiable:** el motor simulado implementa la misma interfaz que el real, así que el resto de la app no sabe con cuál está hablando.

### Seguridad

Quien controla Docker controla la máquina, así que DevDash se protege por defecto:

- **Solo escucha en `127.0.0.1`**: nadie más en tu red puede abrirlo, salvo que cambies `HOST`.
- **Protección CSRF:** las acciones exigen la cabecera `X-DevDash`. Eso obliga al navegador a hacer una comprobación CORS previa que el servidor no acepta, así que una web cualquiera abierta en tu navegador no puede parar tus contenedores.
- **Validación** del id del contenedor, de la acción (`start`, `stop`, `restart`) y del nombre de usuario de GitHub antes de construir ninguna URL.
- **Modo solo lectura** (`READONLY=true`) para desactivar las acciones.

## Instalarlo y usarlo

### Requisitos

- [Node.js](https://nodejs.org) **20.12 o superior**
- [Git](https://git-scm.com)
- *Opcional:* [Docker Desktop](https://www.docker.com/products/docker-desktop/) (o Docker Engine en Linux) para ver tus contenedores reales

Funciona en Windows, macOS y Linux.

### Puesta en marcha

```bash
git clone https://github.com/IviDev02/devdash.git
cd devdash
npm install
npm start
```

Abre **http://localhost:4100**. Si Docker está en marcha verás tus contenedores; si no, verás los de demo (arranca Docker y vuelve a ejecutar `npm start` para cambiar a los reales).

### Configuración (opcional)

Copia `.env.example` como `.env` y ajusta lo que quieras:

| Variable | Por defecto | Para qué sirve |
|---|---|---|
| `GITHUB_USER` | `IviDev02` | Usuario que se muestra al abrir el dashboard por primera vez |
| `GITHUB_TOKEN` | — | Token personal de GitHub (sin permisos). Sube el límite a 5.000 peticiones/hora |
| `DOCKER_HOST` | socket local | `unix://…`, `npipe://…` o `tcp://host:2375` |
| `DOCKER_MODE` | `auto` | `auto`, `docker` (sin demo) o `demo` |
| `READONLY` | `false` | `true` desactiva arrancar/parar/reiniciar |
| `HOST` / `PORT` | `127.0.0.1` / `4100` | Dónde escucha el servidor |

### Con Docker

DevDash también se puede ejecutar como un contenedor más, con acceso al Docker de tu equipo:

```bash
docker compose up -d --build
```

Y abre http://localhost:4100. El puerto solo se publica en `127.0.0.1`.

### Desarrollo

```bash
npm run dev   # API con recarga automática + Vite en http://localhost:5173
npm test      # tests del servidor
```

Los tests cubren el cálculo de métricas de GitHub, la caché con ETag y los errores de la API, el cliente de Docker contra un Docker Engine falso (listado, CPU, memoria, logs multiplexados, acciones), las rutas de la API, la protección de las acciones y el stream de Server-Sent Events.
