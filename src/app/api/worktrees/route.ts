import { NextResponse } from 'next/server';
import { WorktreeManager } from '@/server/worktree-manager';

const manager = new WorktreeManager(process.cwd());

export async function GET() {
  try {
    const worktrees = await manager.listWorktrees();
    return NextResponse.json({ worktrees });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list worktrees' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { projectSlug } = await request.json();

    if (!projectSlug) {
      return NextResponse.json(
        { error: 'projectSlug is required' },
        { status: 400 },
      );
    }

    if (await manager.exists(projectSlug)) {
      return NextResponse.json(
        { error: 'Worktree already exists' },
        { status: 409 },
      );
    }

    const worktree = await manager.createWorktree(projectSlug);
    return NextResponse.json({ worktree }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create worktree' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { projectSlug } = await request.json();

    if (!projectSlug) {
      return NextResponse.json(
        { error: 'projectSlug is required' },
        { status: 400 },
      );
    }

    if (!(await manager.exists(projectSlug))) {
      return NextResponse.json(
        { error: 'Worktree not found' },
        { status: 404 },
      );
    }

    await manager.removeWorktree(projectSlug);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to remove worktree' },
      { status: 500 },
    );
  }
}
