import type { Metadata } from 'next';
import GameClient from './game-client';
import { validRoomCode } from '@/lib/room-code';

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ room?: string | string[] }> }): Promise<Metadata> {
  const params = await searchParams;
  const room = typeof params.room === 'string' && validRoomCode(params.room.toUpperCase()) ? params.room.toUpperCase() : '';
  const image = `https://cambio.shrysjain.me/api/share${room ? `?room=${room}` : ''}`;
  const alt = room ? `Cambio · room ${room}` : 'Cambio';
  return {
    title: 'Cambio',
    openGraph: { title: 'Cambio', siteName: 'Cambio', type: 'website', images: [{ url: image, width: 1200, height: 630, alt }] },
    twitter: { card: 'summary_large_image', title: 'Cambio', images: [{ url: image, alt }] },
  };
}

export default function Page() { return <GameClient/>; }
