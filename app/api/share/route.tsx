import { ImageResponse } from 'next/og';
import { validRoomCode } from '@/lib/room-code';

export function GET(request: Request) {
  const value = new URL(request.url).searchParams.get('room')?.toUpperCase() ?? '';
  const room = validRoomCode(value) ? value : '';
  return new ImageResponse(
    <div style={{ width: '100%', height: '100%', background: '#10251b', color: '#f2f5eb', display: 'flex', alignItems: 'center', padding: '88px', position: 'relative' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 25 }}>
        <div style={{ fontSize: 106, fontWeight: 700, letterSpacing: -6 }}>Cambio</div>
        {room && <div style={{ display: 'flex', alignItems: 'center', gap: 17, color: '#afc9b6' }}><span style={{ fontSize: 22 }}>room</span><span style={{ fontSize: 34, letterSpacing: 7, color: '#f2f5eb' }}>{room}</span></div>}
      </div>
      <div style={{ position: 'absolute', right: 120, top: 140, display: 'flex', flexWrap: 'wrap', width: 236, gap: 16, transform: 'rotate(9deg)' }}>
        {[0, 1, 2, 3].map(i => <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 110, height: 160, background: '#38664d', border: '4px solid #e8efdf', borderRadius: 12, position: 'relative' }}>
          <div style={{ display: 'flex', position: 'absolute', top: 8, left: 8, width: 86, height: 136, border: '1px solid #9fbaa2', borderRadius: 5 }}/>
          <div style={{ display: 'flex', width: 29, height: 29, border: '2px solid #dce8d3', transform: 'rotate(45deg)' }}/>
        </div>)}
      </div>
    </div>,
    { width: 1200, height: 630, headers: { 'Cache-Control': 'public, max-age=86400' } },
  );
}
