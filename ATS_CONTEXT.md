# ATS Inteligente con IA

## Descripción

Sistema de generación automática de ATS (Análisis de Trabajo Seguro) usando inteligencia artificial.

Tecnología:
- Next.js
- OpenAI API
- Vercel

## Motor principal

Archivo:

app/api/generate-ats/route.ts

Este route:

- recibe descripción del trabajo
- identifica tareas críticas
- analiza normativa
- ejecuta motor normativo
- envía contexto a OpenAI
- genera ATS estructurado

## Estructura del ATS

El ATS generado incluye:

- hazards
- controls
- steps
- stop_work
- normative_refs
- normative_analysis
- recommendations

## Motor normativo

Función:

buildNormativeEngine()

Permite aplicar normas técnicas como:

- ASME B30
- API RP 54

Genera:

- controles requeridos
- condiciones stop work

## Objetivo del proyecto

Crear un sistema inteligente que ayude a generar ATS robustos para operaciones industriales como:

- izajes
- trabajos en altura
- sistemas de alta presión
- espacios confinados
- operaciones de perforación y well services