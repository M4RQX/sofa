# 🛋️ Sofá

Partilha de ecrã para até 4 amigos, direto de PC para PC, numa página estática no GitHub Pages.

## Como usar

1. Abre o site, escreve o teu nome e carrega em **Entrar na sala** (é gerado um código de sala).
2. **Copiar link** e manda à malta. Quem abrir o link entra na mesma sala.
3. **Partilhar ecrã** → escolhe ecrã inteiro, janela ou separador.
   - **Qualidade:** Nítido (texto/código, 1080p 30 fps), Fluido (jogos/vídeos, 1080p 60 fps), Leve (720p 30 fps).
   - **Com som:** no Chrome/Edge, partilha um separador ou o ecrã inteiro e marca "Partilhar áudio".
     Com o ecrã inteiro vai o som todo do PC (incluindo a call do Discord), por isso para vídeos é melhor partilhar o separador.
4. Nos ecrãs dos outros: ⤢ foca um ecrã, ⛶ põe em ecrã inteiro (ou duplo clique), 🔊 liga/desliga o som.

Todos podem partilhar ao mesmo tempo. No telemóvel dá para ver, mas não para partilhar (os browsers móveis não deixam).

## Como funciona

- **Sinalização:** [Trystero](https://github.com/dmotz/trystero) `0.26.0` com a rede Nostr (relés públicos). Só serve para os browsers se encontrarem.
- **Vídeo:** WebRTC em malha (cada pessoa liga-se às outras 3). Cifrado ponta a ponta e não passa por nenhum servidor.
- **Débito:** o teto por ligação é subido para o perfil escolhido (1,5 / 4 / 8 Mbps). Quem partilha envia uma cópia a cada pessoa, ou seja, até 3× esse valor de upload.

## Decisões

- **2026-11-01**: só ecrã, sem voz (a voz fica no Discord). Sinalização com Trystero/Nostr, sem servidor nem conta. Alojado em M4RQX/sofa (GitHub Pages).
- **Sem servidor TURN**: em redes que bloqueiam ligações diretas (algumas redes móveis ou de empresa) uma pessoa pode não conseguir ligar-se. Se isso acontecer, adiciona-se um TURN (ex.: Cloudflare, plano gratuito) em `turnConfig`.

## Correr localmente

```bash
python -m http.server 8770 --directory .
```

Abre `http://127.0.0.1:8770/`. A partilha de ecrã exige `https` ou `localhost`.
