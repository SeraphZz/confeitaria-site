'use strict';
// Conteúdo inicial do site. Usado apenas na primeira execução, quando o banco ainda está vazio.
// Depois disso, tudo é editado pelo próprio site (logada como confeiteira).

module.exports = {
  loja: {
    nome: 'Doce Encanto',
    slogan: 'Doces artesanais feitos com carinho, sob encomenda.',
    whatsapp: '5511999999999',
    instagram: 'doceencanto',
    email: 'contato@doceencanto.com.br',
    cidade: 'São Paulo, SP',
  },
  sobre: {
    titulo: 'Olá, eu sou a Helena',
    texto:
      'Aprendi a fazer doces na cozinha da minha avó, mexendo a panela de brigadeiro em cima de um banquinho. ' +
      'O que começou como um carinho para a família virou profissão.\n\n' +
      'Hoje cada encomenda sai da minha cozinha feita à mão, com ingredientes de verdade e sem pressa. ' +
      'Gosto de conversar com cada cliente para entender a ocasião e adaptar o doce ao gosto de quem vai receber.',
    trajetoria: [
      { ano: '2015', titulo: 'Os primeiros pedidos', texto: 'Comecei vendendo brigadeiros para amigos e colegas de trabalho.' },
      { ano: '2018', titulo: 'Formação em confeitaria', texto: 'Concluí o curso profissional de confeitaria e passei a atender festas e eventos.' },
      { ano: '2021', titulo: 'Ateliê próprio', texto: 'Montei meu ateliê e ampliei o cardápio com tortas, bolos e macarons.' },
    ],
  },
  // Como a loja chama o que vende, e o ícone de quem ainda não tem foto.
  catalogo: { nomeSingular: 'Doce', nomePlural: 'Doces', emojiPadrao: '🧁' },
  produtos: [
    { nome: 'Brigadeiro gourmet', preco: 450, unidade: 'unidade', emoji: '🍫', descricao: 'Brigadeiro de chocolate belga, enrolado à mão e finalizado com granulado de chocolate ao leite.' },
    { nome: 'Bolo de cenoura com chocolate', preco: 8500, unidade: 'bolo (aprox. 1,2 kg)', emoji: '🥕', descricao: 'Massa fofinha de cenoura com cobertura generosa de brigadeiro cremoso. Serve cerca de 12 fatias.' },
    { nome: 'Torta de limão', preco: 9500, unidade: 'torta (22 cm)', emoji: '🍋', descricao: 'Base crocante amanteigada, creme de limão siciliano e merengue maçaricado.' },
    { nome: 'Macarons sortidos', preco: 4200, unidade: 'caixa com 6', emoji: '🍬', descricao: 'Caixa com seis macarons em sabores variados: pistache, framboesa, chocolate, baunilha, limão e doce de leite.' },
    { nome: 'Cupcake red velvet', preco: 1200, unidade: 'unidade', emoji: '🧁', descricao: 'Massa aveludada de cacau com cobertura de cream cheese.' },
    { nome: 'Brownie recheado', preco: 1000, unidade: 'unidade', emoji: '🍪', descricao: 'Brownie denso de chocolate meio amargo com recheio de doce de leite.' },
  ],
};
