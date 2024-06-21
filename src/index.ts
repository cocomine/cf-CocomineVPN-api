import {Hono} from 'hono'
import {env} from "hono/adapter";
import {logger} from "hono/logger";
import {secureHeaders} from "hono/secure-headers";

type Env = {
    ORIGINAL_API_HOST: string;
    KV: KVNamespace;
    NODE_ENV: string | undefined;
    WORKER_ACCESS_TOKEN: string;
}

interface I_WS_TICKET_DATA {
    data: {
        ticket: string,
    },
    message: string,
    code: number
}

const app = new Hono()
app.use(logger())
app.use(secureHeaders())

/**
 * Websocket connection
 */
app.get('/api/ws', async (c) => {
    const {ORIGINAL_API_HOST, NODE_ENV} = env<Env>(c)

    // Check if the request is a websocket upgrade
    const upgradeHeader = c.req.header('upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    // Check if the request has a ticket
    if(c.req.query('ticket') === undefined) {
        c.status(400)
        return c.json({code: 400, message: 'No ticket found.'})
    }

    // Create a new URL object from the request URL
    const url = new URL(c.req.url)
    url.host = ORIGINAL_API_HOST
    url.protocol = NODE_ENV === 'development' ? 'ws:' : 'wss:'

    // Connect to the original API
    const websocket = new WebSocket(url.toString())
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    server.accept();
    websocket.addEventListener('message', (e) => {
        server.send(e.data)
    })
    server.addEventListener('message', (e) => {
        websocket.send(e.data)
    })

    websocket.addEventListener('close', () => {
        server.close()
    })
    server.addEventListener('close', () => {
        websocket.close()
    })

    server.addEventListener('error', () => {
        websocket.close()
    });
    websocket.addEventListener('error', () => {
        server.close()
    })

    return c.res = new Response(null, {
        status: 101,
        webSocket: client
    })
})

/**
 * Proxy all requests to the original API
 */
app.all('*', async (c) => {
    const { ORIGINAL_API_HOST, KV , NODE_ENV} = env<Env>(c)

    //check has "cf-connecting-ip" header
    if(NODE_ENV !== "development" && !c.req.raw.headers.has('cf-connecting-ip')) {
        c.status(400)
        return c.json({code: 400, message: 'No IP address found.'})
    }

    // Create a new URL object from the request URL
    const url = new URL(c.req.url)
    url.host = ORIGINAL_API_HOST // Replace the hostname with the original API hostname
    url.pathname = url.pathname.substring(4) // Remove the /api prefix

    try {
        // Fetch the original API
        const response = await fetch(url.toString(), c.req.raw);

        // Intercept and obtain tickets
        // and store it into KV
        /*if(url.pathname === '/vpn/ws/ticket' && response.ok) {
            const data: I_WS_TICKET_DATA = await response.clone().json()
            await KV.put('vpn_ws_ticket:'+data.data.ticket, c.req.header('cf-connecting-ip') ?? '', {expirationTtl: 60});
            console.log('Ticket save:', data.data.ticket, 'for', c.req.header('cf-connecting-ip'))
        }*/

        // Copy over the response
        const modifiedResponse = new Response(response.body, response);

        // Delete the set-cookie from the response so it doesn't override existing cookies
        modifiedResponse.headers.delete("set-cookie")

        return c.res = modifiedResponse
    } catch (e: any) {
        c.status(500)
        return c.json({error: e.message})
    }
})

export default app
