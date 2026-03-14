import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(request) {
  const auth = authenticateRequest(request)
  if (!auth.authenticated) return auth.response
  if (auth.preflight) return new NextResponse(null, { status: 204 })

  try {
    const body = await request.json()
    const { workflow_steps, pain_points, systems_tools, data_sources, handoffs, workarounds, observations, verbatim_quotes } = body

    if (!workflow_steps) return NextResponse.json({ error: 'Missing workflow_steps' }, { status: 400 })

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: `You are an expert at converting interview workflow descriptions into structured flowchart data for React Flow.

Given interview data about a CPG professional's workflow, generate a JSON object with "nodes" and "edges" arrays compatible with React Flow (@xyflow/react).

Node types and when to use them:
- "workflowStep" — a discrete step in their process (white blocks)
- "painPoint" — a specific pain or problem they described (red blocks). Map these from the pain_points data.
- "friction" — workarounds, manual processes, bottlenecks (orange blocks)
- "opportunity" — areas where automation or AI could clearly help (green blocks)
- "handoff" — transitions between people, teams, or systems (purple blocks)
- "systemTool" — a software system or tool used at that step (gray blocks)

Rules:
1. Parse the workflow into 4-8 main sequential steps (workflowStep nodes)
2. Attach pain points as branching nodes connected to the relevant workflow step
3. Identify friction points from workarounds text
4. Mark handoff points from handoffs text
5. Add system/tool nodes connected to steps where they're used
6. Add opportunity nodes where you see clear automation potential
7. Layout: arrange main workflow steps vertically with 200px spacing. Branch nodes (pain, friction, opportunity) offset 350px to the right. System/tool nodes offset 350px to the left. Start at x:400, y:50.
8. Each node needs: id (string), type (one of the 6 types), position ({x, y}), data ({label, description, painIndex (for painPoint nodes — index into pain_points array), tools, quote})
9. Each edge needs: id (string), source (node id), target (node id), animated (boolean — true for handoffs)
10. Keep labels concise (under 40 chars). Put details in the description field.

Return ONLY valid JSON, no markdown, no explanation:
{
  "nodes": [...],
  "edges": [...]
}`,
      messages: [
        {
          role: 'user',
          content: `Interview workflow data:

WORKFLOW STEPS:
${workflow_steps || '(not provided)'}

PAIN POINTS:
${JSON.stringify(pain_points || [], null, 2)}

SYSTEMS/TOOLS:
${systems_tools || '(not provided)'}

DATA SOURCES:
${data_sources || '(not provided)'}

HANDOFFS:
${handoffs || '(not provided)'}

WORKAROUNDS:
${workarounds || '(not provided)'}

OBSERVATIONS:
${observations || '(not provided)'}

KEY QUOTES:
${verbatim_quotes || '(not provided)'}`
        }
      ],
    })

    const text = response.content[0].text
    let parsed
    try {
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      return NextResponse.json({ error: 'Failed to parse AI response', raw: text }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: parsed })
  } catch (err) {
    console.error('Flow generation error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
