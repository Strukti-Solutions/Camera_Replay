-- Fase 1: a conta de aluno presa a uma arena e as reservas feitas pelo dono saem.
-- Ordem: as tabelas filhas antes de alunos e reservas.
drop table clipe_alunos;
drop table reserva_alunos;
drop table sessoes_aluno;
drop table alunos;
drop table reservas;

delete from tentativas_login where email like 'aluno:%';
