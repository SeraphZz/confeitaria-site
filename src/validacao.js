'use strict';
// Validação dos campos recebidos do navegador. Tudo o que entra passa por aqui antes de chegar ao banco.

const { ErroHttp } = require('./http');

function texto(valor, { max, obrigatorio = false, campo }) {
  if (valor == null) valor = '';
  if (typeof valor !== 'string') throw new ErroHttp(400, `Campo inválido: ${campo}.`);
  const limpo = valor.trim();
  if (obrigatorio && !limpo) throw new ErroHttp(400, `Preencha o campo: ${campo}.`);
  if (limpo.length > max) throw new ErroHttp(400, `O campo "${campo}" aceita até ${max} caracteres.`);
  return limpo;
}

function inteiro(valor, { min, max, campo }) {
  if (!Number.isInteger(valor) || valor < min || valor > max) throw new ErroHttp(400, `Valor inválido: ${campo}.`);
  return valor;
}

function lerEmail(valor) {
  const email = texto(valor, { max: 120, obrigatorio: true, campo: 'e-mail' }).toLowerCase();
  if (!/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(email)) throw new ErroHttp(400, 'Informe um e-mail válido.');
  return email;
}

function lerTelefone(valor) {
  const telefone = String(valor || '').replace(/\D/g, '');
  if (telefone.length < 10 || telefone.length > 13) throw new ErroHttp(400, 'Informe um telefone com DDD.');
  return telefone;
}

// Os dados do ViaCEP chegam pelo navegador, então são validados aqui como qualquer outro campo digitado.
function lerEndereco(valor, obrigatorio) {
  const e = valor && typeof valor === 'object' ? valor : {};
  const cep = String(e.cep || '').replace(/\D/g, '');
  if (cep.length !== 8 && (obrigatorio || cep.length > 0)) throw new ErroHttp(400, 'Informe um CEP com 8 números.');
  const uf = texto(e.uf, { max: 2, obrigatorio, campo: 'UF' }).toUpperCase();
  if (uf && !/^[A-Z]{2}$/.test(uf)) throw new ErroHttp(400, 'UF inválida.');
  return {
    cep, uf,
    rua: texto(e.rua, { max: 120, obrigatorio, campo: 'rua' }),
    numero: texto(e.numero, { max: 10, obrigatorio, campo: 'número' }),
    complemento: texto(e.complemento, { max: 60, campo: 'complemento' }),
    bairro: texto(e.bairro, { max: 80, campo: 'bairro' }),
    cidade: texto(e.cidade, { max: 80, obrigatorio, campo: 'cidade' }),
  };
}

// "Rua das Flores, 10 - apto 2 - Centro, São Paulo/SP - CEP 01001-000"
function formatarEndereco(e) {
  const linha1 = [e.rua && `${e.rua}${e.numero ? `, ${e.numero}` : ''}`, e.complemento, e.bairro].filter(Boolean).join(' - ');
  const cidade = [e.cidade, e.uf].filter(Boolean).join('/');
  const cep = e.cep ? `CEP ${e.cep.slice(0, 5)}-${e.cep.slice(5)}` : '';
  return [[linha1, cidade].filter(Boolean).join(', '), cep].filter(Boolean).join(' - ');
}

module.exports = { texto, inteiro, lerEmail, lerTelefone, lerEndereco, formatarEndereco };
