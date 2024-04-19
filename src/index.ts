import {Hono} from 'hono'
import {env} from "hono/adapter";

type Env = {
    MTLS_CERT: Fetcher;
    ORIGINAL_API_HOSTNAME: string;
}

const app = new Hono()

app.all('*', async (c) => {
    const { ORIGINAL_API_HOSTNAME } = env<Env>(c)

    // Create a new URL object from the request URL
    const url = new URL(c.req.url)
    url.hostname = ORIGINAL_API_HOSTNAME
    url.pathname = url.pathname.substring(4)

    try {
        const response = await fetch(url.toString(), c.req.raw);

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
