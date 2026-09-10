// A FLAG do Blueprint V2 — agora LIGADA por padrão, e por quê.
//
// Ela nasceu desligada enquanto o V2 não estava provado e a tela não sabia mostrá-lo. Isso
// mudou: a proposta exibe os recursos e as operações, o diálogo pergunta o que entra no ar e
// por onde a resposta sai, a saga liga a cadeia inteira depois do teste, e os critérios de
// saída do §22 estão atendidos. Uma flag desligada depois disso não protege ninguém — ela só
// impede o produto de chegar a quem ele foi feito para atender.
//
// O que NÃO some com o padrão invertido é o caminho de volta:
//
//     ASSISTANT_BLUEPRINT_V2=0
//
// Desligada, nada muda em relação ao V1: o projeto não ganha `blueprintV2`, a saga não roda o
// passo do V2 e o hash é exatamente o que já era. Projetos que JÁ têm plano V2 continuam
// aplicáveis — a flag controla se planos novos são compilados, não se os antigos valem.
//
// Remover a flag de vez apagaria esse rollback e transformaria "voltar atrás" num deploy.
// Enquanto ela custa uma linha, mantê-la é mais barato que o incidente que ela evita.

/** `0`, `false` ou `off` desligam. Qualquer outra coisa — inclusive ausência — deixa ligado. */
export const assistantV2Enabled = (): boolean => !/^(0|false|off)$/i.test(String(process.env.ASSISTANT_BLUEPRINT_V2 ?? '').trim())


// A FLAG DAS FERRAMENTAS do Assistente — nasce DESLIGADA, e por quê.
//
// Com ela ligada, o turno deixa de ser uma chamada só e passa pelo laço de ferramentas: o
// modelo lê o inventário, propõe recursos tipados e recebe a recusa de volta quando erra o
// preenchimento. É a virada que tira o teto do compilador — ele só entendia o que alguém
// escreveu regex para entender.
//
// Ela nasceu desligada porque muda o custo (uma chamada vira até seis) e introduz
// não-determinismo. Ficou desligada tempo demais: com ela apagada, o turno continuava sendo
// o compilador adivinhando pela frase, e o dono viu isso em produção — o plano saía certo e
// nenhuma ferramenta era chamada. Uma virada que ninguém liga é uma virada que não aconteceu.
//
// O caminho de volta continua sendo uma variável, e não um deploy:
//
//     ASSISTANT_TOOLS=0
//
// Desligada, o turno é exatamente o que era: uma chamada, e a leitura por expressão regular
// como único caminho. É por isso que a regex ainda não saiu — enquanto o rollback existir,
// ele precisa levar a algum lugar.

/** `0`, `false` ou `off` desligam. Qualquer outra coisa — inclusive ausência — deixa ligado. */
export const assistantToolsEnabled = (): boolean => !/^(0|false|off)$/i.test(String(process.env.ASSISTANT_TOOLS ?? '').trim())
