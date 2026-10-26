// Bundled for the browser by test/browser.test.mjs. Runs the REAL mesh + provider inside Chrome.
import * as Y from 'yjs'
import YProvider from 'y-partyserver/provider'
import { P2PMesh } from '../../../src/lib/p2p/mesh'

;(window as any).startPeer = (opts: { host: string; room: string; token: string }) => {
  const doc = new Y.Doc()
  const provider: any = new YProvider(opts.host, opts.room, doc, {
    protocol: 'ws', prefix: `/ws/${opts.room}`, disableBc: true,
    params: async () => ({ token: opts.token }),
  })
  const got: any = { cursors: [], shapes: [], ends: [] }
  const mesh = new P2PMesh({
    provider,
    iceServers: [],
    onCursor: (from, cursor, seq) => got.cursors.push({ from, cursor, seq, at: performance.now() }),
    onShape: (from, preview) => got.shapes.push({ from, preview }),
    onShapeEnd: (_f, ids) => got.ends.push(ids),
  })
  provider.on('status', ({ status }: any) => status === 'connected' && mesh.start())
  provider.awareness.setLocalStateField('user', { id: opts.token.slice(-6), name: 'p', color: '#000' })
  ;(window as any).peer = { doc, provider, mesh, got, clientId: doc.clientID }
  return doc.clientID
}
