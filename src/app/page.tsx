'use client';
import { useState, useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';

type ResumeData = {
  name: string;
  email?: string;
  skills: string[];
  summary?: string;
  experience_years?: number;
};

type McqQuestion = {
  type: 'mcq';
  question: string;
  options: string[];
  correctAnswer: number;
  skill?: string;
  explanation?: string;
};

type CodingQuestion = {
  type: 'coding';
  prompt: string;
  skill?: string;
  difficulty?: string;
  starterCode?: string;
  expectedKeywords?: string[];
  sampleInput?: string;
  sampleOutput?: string;
  explanation?: string;
};

type AssessmentQuestion = McqQuestion | CodingQuestion;

type DetailedQuestion = {
  type: 'mcq' | 'coding';
  question: string;
  skill?: string;
  explanation?: string;
  userAnswer?: number | string;
  isCorrect?: boolean;
  correctAnswer?: number;
  options?: string[];
  expectedKeywords?: string[];
  difficulty?: string;
};

type ResultData = {
  correct: number;
  total: number;
  quizScore: number;
  codingScore: number;
  confidenceScore: number;
  resumeQuality: number;
  skillBreadth: number;
  trustScore: number;
  verdict: string;
  detailed: DetailedQuestion[];
};

export default function Home() {
  const [step, setStep] = useState<'upload' | 'skills' | 'quiz' | 'result'>('upload');
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [resume, setResume] = useState<ResumeData | null>(null);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [answers, setAnswers] = useState<Array<number | string>>([]);
  const [result, setResult] = useState<ResultData | null>(null);
  const generationRequestRef = useRef(0);
  const generatingRef = useRef(false);

  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setError('');
    setLoading('AI reading your resume...');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/parse-resume', { method: 'POST', body: fd });
      const data = (await res.json()) as ResumeData & { error?: string };
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setResume(data);
      setStep('skills');
    } catch (caughtError: unknown) {
      const message = caughtError instanceof Error ? caughtError.message : 'Upload failed';
      setError(message);
    } finally {
      setLoading('');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/msword': ['.doc'],
    },
    maxFiles: 1,
  });

  const generateQuiz = async () => {
    if (!resume || generatingRef.current || step !== 'skills') return;

    generatingRef.current = true;
    const requestId = ++generationRequestRef.current;
    setError('');
    setLoading('AI generating mixed MCQ + coding assessment...');
    try {
      const res = await fetch('/api/generate-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skills: resume.skills }),
      });
      const data = (await res.json()) as { questions?: AssessmentQuestion[]; error?: string };
      if (!res.ok) throw new Error(data.error || 'Quiz failed');
      if (requestId !== generationRequestRef.current) return;

      const nextQuestions = data.questions ?? [];
      const initialAnswers = nextQuestions.map((question) =>
        question.type === 'mcq' ? -1 : '',
      );
      setQuestions(nextQuestions);
      setAnswers(initialAnswers);
      setStep('quiz');
    } catch (caughtError: unknown) {
      if (requestId !== generationRequestRef.current) return;

      const message = caughtError instanceof Error ? caughtError.message : 'Quiz failed';
      setError(message);
    } finally {
      if (requestId === generationRequestRef.current) {
        generatingRef.current = false;
        setLoading('');
      }
    }
  };

  const submitQuiz = () => {
    if (!resume || questions.length === 0) return;

    let mcqCorrect = 0;
    let mcqTotal = 0;
    let codingCorrect = 0;
    let codingTotal = 0;

    const detailed: DetailedQuestion[] = questions.map((q, i) => {
      const userAnswer = answers[i] ?? (q.type === 'mcq' ? -1 : '');

      if (q.type === 'mcq') {
        mcqTotal += 1;
        const isCorrect = Number(userAnswer) === q.correctAnswer;
        if (isCorrect) mcqCorrect += 1;

        return {
          type: 'mcq',
          question: q.question,
          skill: q.skill,
          explanation: q.explanation,
          userAnswer: Number(userAnswer),
          isCorrect,
          correctAnswer: q.correctAnswer,
          options: q.options,
        };
      }

      codingTotal += 1;
      const textAnswer = String(userAnswer).trim();
      const expectedKeywords = q.expectedKeywords ?? [];
      const hasAttempt = textAnswer.length > 20;
      const keywordMatchCount = expectedKeywords.filter((keyword) =>
        textAnswer.toLowerCase().includes(keyword.toLowerCase()),
      ).length;
      const isCorrect =
        expectedKeywords.length === 0
          ? hasAttempt
          : keywordMatchCount >= Math.min(2, expectedKeywords.length || 1);
      if (isCorrect) codingCorrect += 1;

      return {
        type: 'coding',
        question: q.prompt,
        skill: q.skill,
        explanation: q.explanation,
        userAnswer: textAnswer,
        isCorrect,
        difficulty: q.difficulty,
        expectedKeywords: q.expectedKeywords,
      };
    });

    const quizScore = mcqTotal > 0 ? Math.round((mcqCorrect / mcqTotal) * 100) : 0;
    const codingScore = codingTotal > 0 ? Math.round((codingCorrect / codingTotal) * 100) : 0;
    const resumeQuality = Math.min(50 + resume.skills.length * 5, 100);
    const skillBreadth = Math.min(resume.skills.length * 8, 100);
    const confidenceScore = Math.round(((mcqCorrect + codingCorrect) / questions.length) * 100);
    const trustScore = Math.round(confidenceScore * 0.8 + resumeQuality * 0.2);

    let verdict = '';
    if (trustScore >= 85) verdict = 'Highly Verified - Strong Hire Signal';
    else if (trustScore >= 70) verdict = 'Verified - Good Match';
    else if (trustScore >= 50) verdict = 'Partially Verified - Needs Review';
    else verdict = 'Low Trust - Skills Mismatch';

    setResult({
      correct: mcqCorrect + codingCorrect,
      total: questions.length,
      quizScore,
      codingScore,
      confidenceScore,
      resumeQuality,
      skillBreadth,
      trustScore,
      verdict,
      detailed,
    });
    setStep('result');
  };

  const reset = () => {
    generationRequestRef.current += 1;
    generatingRef.current = false;
    setStep('upload');
    setResume(null);
    setQuestions([]);
    setAnswers([]);
    setResult(null);
    setError('');
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-5xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            SkillLens AI
          </h1>
          <p className="text-slate-400 italic">
            Resume se zyada, actual skills ko verify karo.
          </p>
        </div>

        <div className="flex justify-center gap-2 mb-8">
          {['Upload', 'Skills', 'Quiz', 'Score'].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  ['upload', 'skills', 'quiz', 'result'].indexOf(step) >= i
                    ? 'bg-blue-600'
                    : 'bg-slate-700'
                }`}
              >
                {i + 1}
              </div>
              <span className="text-sm text-slate-400 hidden sm:inline">{s}</span>
              {i < 3 && <div className="w-6 h-px bg-slate-600" />}
            </div>
          ))}
        </div>

        {error && (
          <div className="bg-red-900/40 border border-red-500 rounded-lg p-4 mb-6">
            {error}
          </div>
        )}
        {loading && (
          <div className="bg-blue-900/30 border border-blue-500 rounded-lg p-4 mb-6 text-center animate-pulse">
            {loading}
          </div>
        )}

        {step === 'upload' && !loading && (
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition ${
              isDragActive
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-slate-600 hover:border-blue-500'
            }`}
          >
            <input {...getInputProps()} />
            <p className="text-6xl mb-4">PDF / DOCX</p>
            <p className="text-xl font-semibold mb-2">
              {isDragActive ? 'Drop your resume here!' : 'Drop your resume (PDF or DOCX)'}
            </p>
            <p className="text-slate-400 text-sm">
              or click to browse - AI will extract your skills and generate a mixed assessment
            </p>
          </div>
        )}

        {step === 'skills' && resume && (
          <div className="bg-slate-800/60 rounded-2xl p-6 border border-slate-700">
            <h2 className="text-2xl font-bold mb-1">Resume Parsed</h2>
            <p className="text-slate-400 mb-6">
              {resume.name} {resume.email && `- ${resume.email}`}
            </p>
            <div className="mb-6">
              <p className="text-sm text-slate-400 mb-2">
                Detected Skills ({resume.skills.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {resume.skills.map((s: string, index: number) => (
                  <span
                    key={`${s}-${index}`}
                    className="bg-blue-600/30 text-blue-300 border border-blue-500/40 px-3 py-1 rounded-full text-sm"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
            {resume.summary && (
              <p className="text-slate-300 mb-6 italic">“{resume.summary}”</p>
            )}
            <button
              onClick={generateQuiz}
              disabled={Boolean(loading)}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed py-4 rounded-xl font-bold text-lg transition"
            >
              {loading ? 'Generating Assessment...' : 'Generate Mixed AI Assessment'}
            </button>
          </div>
        )}

        {step === 'quiz' && (
          <div>
            <h2 className="text-2xl font-bold mb-6">
              Skill Assessment - {questions.length} Questions
            </h2>
            {questions.map((q, i) => (
              <div
                key={i}
                className="bg-slate-800/60 rounded-2xl p-6 mb-4 border border-slate-700"
              >
                {q.type === 'mcq' ? (
                  <>
                    <div className="flex items-start justify-between mb-4 gap-3">
                      <p className="font-medium text-lg flex-1">
                        {i + 1}. {q.question}
                      </p>
                      {q.skill && (
                        <span className="text-xs bg-purple-600/30 text-purple-300 px-2 py-1 rounded-full ml-3 whitespace-nowrap">
                          {q.skill}
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      {q.options.map((opt: string, j: number) => (
                        <label
                          key={j}
                          className={`block p-3 rounded-lg cursor-pointer transition border ${
                            Number(answers[i]) === j
                              ? 'bg-blue-600/40 border-blue-500'
                              : 'bg-slate-700/50 border-transparent hover:bg-slate-700'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`q${i}`}
                            checked={Number(answers[i]) === j}
                            onChange={() => {
                              const a = [...answers];
                              a[i] = j;
                              setAnswers(a);
                            }}
                            className="mr-3"
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-start justify-between mb-4 gap-3">
                      <p className="font-medium text-lg flex-1">
                        {i + 1}. {q.prompt}
                      </p>
                      <div className="flex items-center gap-2">
                        {q.skill && (
                          <span className="text-xs bg-purple-600/30 text-purple-300 px-2 py-1 rounded-full whitespace-nowrap">
                            {q.skill}
                          </span>
                        )}
                        {q.difficulty && (
                          <span className="text-xs bg-amber-600/30 text-amber-300 px-2 py-1 rounded-full whitespace-nowrap">
                            {q.difficulty}
                          </span>
                        )}
                      </div>
                    </div>
                    {q.sampleInput && q.sampleOutput && (
                      <div className="mb-4 grid md:grid-cols-2 gap-3 text-sm">
                        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-3">
                          <p className="text-slate-400 mb-1">Input</p>
                          <pre className="whitespace-pre-wrap">{q.sampleInput}</pre>
                        </div>
                        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-3">
                          <p className="text-slate-400 mb-1">Expected Output</p>
                          <pre className="whitespace-pre-wrap">{q.sampleOutput}</pre>
                        </div>
                      </div>
                    )}
                    {q.starterCode && (
                      <div className="mb-4 bg-slate-900/60 border border-slate-700 rounded-lg p-3 text-sm">
                        <p className="text-slate-400 mb-2">Starter Code</p>
                        <pre className="whitespace-pre-wrap font-mono text-xs">{q.starterCode}</pre>
                      </div>
                    )}
                    <textarea
                      value={String(answers[i] ?? '')}
                      onChange={(event) => {
                        const a = [...answers];
                        a[i] = event.target.value;
                        setAnswers(a);
                      }}
                      rows={8}
                      placeholder="Write your solution here..."
                      className="w-full rounded-xl border border-slate-600 bg-slate-900/70 p-3 text-white placeholder:text-slate-500 focus:border-blue-500 outline-none"
                    />
                  </>
                )}
              </div>
            ))}
            <button
              onClick={submitQuiz}
              disabled={answers.some((answer) => answer === -1 || (typeof answer === 'string' && !answer.trim()))}
              className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed py-4 rounded-xl font-bold text-lg transition"
            >
              {answers.some((answer) => answer === -1 || (typeof answer === 'string' && !answer.trim()))
                ? `Complete all questions (${answers.filter((answer) => answer !== -1 && (typeof answer !== 'string' || answer.trim())).length}/${questions.length})`
                : 'Submit & Get Skill Trust Score'}
            </button>
          </div>
        )}

        {step === 'result' && result && (
          <div>
            <div className="bg-slate-800/60 rounded-2xl p-8 border border-slate-700 text-center mb-6">
              <p className="text-sm text-slate-400 uppercase tracking-wide mb-2">
                Final Skill Trust Score
              </p>
              <div className="text-7xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent mb-4">
                {result.trustScore}
              </div>
              <p className="text-lg mb-8">{result.verdict}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <div className="min-w-0 bg-slate-700/60 rounded-xl p-3 sm:p-4">
                  <p className="min-h-8 text-[11px] sm:text-xs leading-tight text-slate-400 mb-1">MCQ Score</p>
                  <p className="text-xl sm:text-2xl font-bold text-blue-400">{result.quizScore}%</p>
                </div>
                <div className="min-w-0 bg-slate-700/60 rounded-xl p-3 sm:p-4">
                  <p className="min-h-8 text-[11px] sm:text-xs leading-tight text-slate-400 mb-1">Coding Score</p>
                  <p className="text-xl sm:text-2xl font-bold text-violet-400">{result.codingScore}%</p>
                </div>
                <div className="min-w-0 bg-slate-700/60 rounded-xl p-3 sm:p-4">
                  <p className="min-h-8 text-[11px] sm:text-xs leading-tight text-slate-400 mb-1">AI Confidence</p>
                  <p className="text-xl sm:text-2xl font-bold text-amber-400">{result.confidenceScore}%</p>
                </div>
                <div className="min-w-0 bg-slate-700/60 rounded-xl p-3 sm:p-4">
                  <p className="min-h-8 text-[11px] sm:text-xs leading-tight text-slate-400 mb-1">Resume Quality</p>
                  <p className="text-xl sm:text-2xl font-bold text-emerald-400">{result.resumeQuality}</p>
                </div>
              </div>
            </div>
            <h3 className="text-xl font-bold mb-4">Detailed Review</h3>
            {result.detailed.map((q, i) => (
              <div
                key={i}
                className={`rounded-xl p-5 mb-3 border ${
                  q.isCorrect
                    ? 'bg-green-900/20 border-green-600/50'
                    : 'bg-red-900/20 border-red-600/50'
                }`}
              >
                <p className="font-medium mb-3">
                  {q.type === 'mcq'
                    ? q.isCorrect
                      ? 'Correct:'
                      : 'Wrong:'
                    : q.isCorrect
                      ? 'Coding attempt accepted:'
                      : 'Coding attempt review:'}{' '}
                  {q.question}
                </p>
                {q.type === 'mcq' && (
                  <>
                    <p className="text-sm text-slate-300 mb-1">
                      <span className="text-slate-500">Your answer:</span>{' '}
                      {q.options?.[Number(q.userAnswer)] ?? 'No answer'}
                    </p>
                    {!q.isCorrect && (
                      <p className="text-sm text-green-300 mb-1">
                        <span className="text-slate-500">Correct answer:</span>{' '}
                        {q.options?.[Number(q.correctAnswer)]}
                      </p>
                    )}
                  </>
                )}
                {q.type === 'coding' && (
                  <>
                    <p className="text-sm text-slate-300 mb-1">
                      <span className="text-slate-500">Your answer:</span>{' '}
                      {String(q.userAnswer || 'No answer')}
                    </p>
                    {q.expectedKeywords && q.expectedKeywords.length > 0 && (
                      <p className="text-sm text-slate-400 mt-2">
                        Expected keywords: {q.expectedKeywords.join(', ')}
                      </p>
                    )}
                  </>
                )}
                {q.explanation && (
                  <p className="text-sm text-slate-400 italic mt-2">
                    Explanation: {q.explanation}
                  </p>
                )}
              </div>
            ))}
            <button
              onClick={reset}
              className="w-full mt-6 bg-slate-700 hover:bg-slate-600 py-3 rounded-xl font-semibold transition"
            >
              Test Another Resume
            </button>
          </div>
        )}
      </div>
    </main>
  );
}