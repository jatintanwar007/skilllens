import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const maxDuration = 90;

type GeneratedQuestion = Record<string, unknown> & {
  type: 'mcq' | 'coding';
};

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

function extractJsonObject(content: string) {
  const start = content.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < content.length; index += 1) {
    const character = content[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) return content.slice(start, index + 1);
    }
  }

  return null;
}

function escapeControlCharactersInStrings(json: string) {
  let result = '';
  let inString = false;
  let escaped = false;

  for (const character of json) {
    const code = character.charCodeAt(0);

    if (inString && code < 0x20) {
      result += `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }

    result += character;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
    } else if (character === '"') {
      inString = true;
    }
  }

  return result;
}

function isGeneratedQuestion(value: unknown): value is GeneratedQuestion {
  if (!value || typeof value !== 'object') return false;

  const question = value as Record<string, unknown>;
  if (question.type === 'mcq') {
    return (
      typeof question.question === 'string' &&
      Array.isArray(question.options) &&
      question.options.length >= 2 &&
      Number.isInteger(question.correctAnswer) &&
      Number(question.correctAnswer) >= 0 &&
      Number(question.correctAnswer) < question.options.length
    );
  }

  return question.type === 'coding' && typeof question.prompt === 'string';
}

function parseQuestions(content: string): GeneratedQuestion[] {
  const jsonObject = extractJsonObject(content.replace(/```json|```/g, '').trim());
  if (!jsonObject) throw new Error('AI did not return a valid JSON object.');

  const payload: unknown = JSON.parse(escapeControlCharactersInStrings(jsonObject));
  const values = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && 'questions' in payload && Array.isArray(payload.questions)
      ? payload.questions
      : [];

  return values.filter(isGeneratedQuestion);
}

function limitQuestionMix(questions: GeneratedQuestion[], mcqLimit: number, codingLimit: number) {
  const mcqs = questions.filter((question) => question.type === 'mcq').slice(0, mcqLimit);
  const coding = questions.filter((question) => question.type === 'coding').slice(0, codingLimit);
  return [...mcqs, ...coding];
}

async function generateQuestions(
  skills: string[],
  mcqCount: number,
  codingCount: number,
  existingQuestions: GeneratedQuestion[] = [],
) {
  const existingPrompts = existingQuestions.map((question) =>
    question.type === 'mcq' ? question.question : question.prompt,
  );
  const completion = await createChatCompletion(
    [
      {
        role: 'user',
        content: `Create exactly ${mcqCount + codingCount} new assessment questions for these candidate skills: ${skills.join(', ')}.
Return ONLY valid JSON in this shape: {"questions":[...]}
Create exactly ${mcqCount} MCQ questions with fields: type="mcq", question, options (4 strings), correctAnswer (zero-based index), skill, explanation.
Create exactly ${codingCount} coding questions with fields: type="coding", prompt, skill, difficulty, starterCode, expectedKeywords (array of 2-4 strings), sampleInput, sampleOutput, explanation.
Rules:
- MCQs should be practical and realistic; balance correct answer positions.
- Coding tasks should be short, real-world, and assess implementation in JavaScript, TypeScript, or React.
- Make every question relevant to the listed skills.
- Do not repeat or paraphrase these existing questions: ${JSON.stringify(existingPrompts)}
- Return no markdown and no text outside the JSON object.`,
      },
    ],
    0.4,
  );

  return parseQuestions(completion.choices[0].message.content || '');
}

export async function POST(req: NextRequest) {
  try {
    const { skills } = await req.json();

    if (!skills || skills.length === 0) {
      return NextResponse.json({ error: 'No skills provided' }, { status: 400 });
    }

    let questions: GeneratedQuestion[] = [];
    try {
      questions = limitQuestionMix(await generateQuestions(skills, 8, 2), 8, 2);
    } catch (error) {
      console.error('Initial assessment generation failed:', error);
    }

    const mcqCount = questions.filter((question) => question.type === 'mcq').length;
    const codingCount = questions.filter((question) => question.type === 'coding').length;
    if (mcqCount < 8 || codingCount < 2) {
      const additionalQuestions = await generateQuestions(
        skills,
        8 - mcqCount,
        2 - codingCount,
        questions,
      );
      questions = limitQuestionMix([...questions, ...additionalQuestions], 8, 2);
    }

    if (questions.length !== 10) {
      throw new Error(
        `Could not complete all 10 questions (received ${questions.length}). Please retry generation.`,
      );
    }

    return NextResponse.json({ questions });
  } catch (error: unknown) {
    console.error('Quiz error:', error);
    const message = error instanceof Error ? error.message : 'Quiz generation failed';
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
