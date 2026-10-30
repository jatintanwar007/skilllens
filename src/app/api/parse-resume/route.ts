import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const maxDuration = 60;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

const getModelCandidates = () => {
  const configuredModel = process.env.AI_MODEL?.trim();
  const candidates = new Set<string>();

  if (configuredModel) {
    candidates.add(configuredModel);
    candidates.add(configuredModel.replace(/:free$/i, ''));
  }

  candidates.add('meta-llama/llama-3.1-8b-instruct');
  candidates.add('openai/gpt-4o-mini');

  return Array.from(candidates).filter(Boolean);
};

async function createChatCompletion(
  messages: Parameters<typeof openai.chat.completions.create>[0]['messages'],
  temperature: number,
) {
  let lastError: unknown;

  for (const model of getModelCandidates()) {
    try {
      return await openai.chat.completions.create({
        model,
        messages,
        temperature,
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('AI completion failed');
}

async function extractResumeText(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type.toLowerCase();
  const fileName = file.name.toLowerCase();

  if (mimeType.includes('pdf') || fileName.endsWith('.pdf')) {
  // Worker ko pehle import karo — ye pdfjs-dist ke liye canvas polyfill setup karta hai
  const { CanvasFactory } = await import('pdf-parse/worker');
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer, CanvasFactory });
  const pdfData = await parser.getText();
  return pdfData.text;
}

  if (
    mimeType.includes('word') ||
    fileName.endsWith('.docx') ||
    fileName.endsWith('.doc')
  ) {
    const mammoth = await import('mammoth');
    const docxResult = await mammoth.extractRawText({ buffer });
    return docxResult.value;
  }

  if (fileName.endsWith('.txt')) {
    return buffer.toString('utf8');
  }

  throw new Error('Unsupported file type. Please upload a PDF or DOCX resume.');
}

function normalizeSkills(value: unknown) {
  if (!Array.isArray(value)) return [];

  const uniqueSkills = new Map<string, string>();
  for (const skill of value) {
    if (typeof skill !== 'string') continue;

    const normalizedSkill = skill.trim();
    const key = normalizedSkill.toLowerCase();
    if (normalizedSkill && !uniqueSkills.has(key)) {
      uniqueSkills.set(key, normalizedSkill);
    }
  }

  return Array.from(uniqueSkills.values());
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const resumeText = await extractResumeText(file);

    if (!resumeText || resumeText.length < 50) {
      return NextResponse.json(
        { error: 'Could not extract text from the document. Please upload a text-based PDF or DOCX resume.' },
        { status: 400 },
      );
    }

    const aiRes = await createChatCompletion(
      [
        {
          role: 'user',
          content: `Extract from this resume. Return ONLY valid JSON (no markdown):
{
  "name": "Full Name",
  "email": "email@example.com",
  "skills": ["Skill1", "Skill2"],
  "experience_years": 2,
  "summary": "one line summary"
}
Resume:
${resumeText.slice(0, 4000)}
Return ONLY JSON.`,
        },
      ],
      0.1,
    );

    let content = aiRes.choices[0].message.content || '{}';
    content = content.replace(/```json|```/g, '').trim();

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('AI did not return valid JSON. Raw: ' + content.slice(0, 200));
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const skills = normalizeSkills(parsed.skills);

    return NextResponse.json({
      success: true,
      name: parsed.name || 'Candidate',
      email: parsed.email || '',
      skills,
      experience_years: parsed.experience_years || 0,
      summary: parsed.summary || '',
    });
  } catch (error: unknown) {
    console.error('Parse error:', error);
    const message = error instanceof Error ? error.message : 'Parsing failed';
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
