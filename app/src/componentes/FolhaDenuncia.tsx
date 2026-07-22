/**
 * C12.5 + Redesign "3a" — bottom-sheet de "Denunciar preço": os 4 motivos com
 * rádio e o envio. Aparece no card do veredito (Verificar) e no kebab da lista
 * (Produtos), por isso mora aqui em vez de duplicado nas duas telas.
 *
 * Os motivos vêm do enum COMPARTILHADO (`MotivoDenuncia`), o mesmo que o backend
 * valida e o Postgres guarda — os rótulos daqui são só a face visível deles.
 *
 * O componente não conhece a API: recebe `aoEnviar(motivo)` e mostra o estado de
 * envio. Quem chama decide o que fazer com a falha (a tela sabe o contexto geo).
 */

import { type MotivoDenuncia, MOTIVOS_DENUNCIA } from '@barganha/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { espaco, raio, useTema } from '@/tema';

import { Botao } from './Botao';
import { FolhaInferior } from './FolhaInferior';
import { IconeCheck } from './icones';
import { Texto } from './Texto';

/** Rótulo de cada motivo do enum (textos do handoff). */
const ROTULOS: Record<MotivoDenuncia, string> = {
  preco_divergente: 'O preço não confere com a gôndola',
  produto_errado: 'É outro produto com nome parecido',
  unidade_errada: 'A unidade ou a quantidade está errada',
  outro: 'Outro motivo',
};

export interface FolhaDenunciaProps {
  visivel: boolean;
  /** Nome do produto denunciado (aparece na pergunta). */
  produto: string;
  aoFechar: () => void;
  /** Envia a denúncia. Lançar aqui mantém o sheet aberto e mostra o erro. */
  aoEnviar: (motivo: MotivoDenuncia) => Promise<void>;
}

export function FolhaDenuncia({ visivel, produto, aoFechar, aoEnviar }: FolhaDenunciaProps) {
  const { c } = useTema();
  const [motivo, setMotivo] = useState<MotivoDenuncia>('preco_divergente');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar() {
    setEnviando(true);
    setErro(null);
    try {
      await aoEnviar(motivo);
    } catch {
      // Sem sinal ou backend fora: dizer a verdade em vez de fingir sucesso.
      setErro('Não deu para enviar agora. Verifique a conexão e tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <FolhaInferior
      visivel={visivel}
      titulo="Denunciar preço"
      aoFechar={aoFechar}
      rotuloFechar={enviando ? null : 'Cancelar'}
    >
      <Texto cor="suave" tamanho="sm" style={{ marginBottom: espaco.sm }}>
        O que está errado em “{produto}”?
      </Texto>

      {MOTIVOS_DENUNCIA.map((m, i) => (
        <Pressable
          key={m}
          onPress={() => setMotivo(m)}
          disabled={enviando}
          accessibilityRole="radio"
          accessibilityState={{ checked: motivo === m, disabled: enviando }}
          style={[
            estilos.linha,
            i < MOTIVOS_DENUNCIA.length - 1 && {
              borderBottomWidth: 1,
              borderBottomColor: c.linha,
            },
          ]}
        >
          <View
            style={[
              estilos.radio,
              { borderColor: motivo === m ? c.tinta : c.borda },
              motivo === m && { backgroundColor: c.tinta },
            ]}
          >
            {motivo === m ? <IconeCheck tamanho={11} cor={c.sobreTeal} /> : null}
          </View>
          <Texto tamanho="sm" peso={motivo === m ? 'bold' : 'medium'} style={{ flex: 1 }}>
            {ROTULOS[m]}
          </Texto>
        </Pressable>
      ))}

      {erro ? (
        <Texto tamanho="sm" cor="caro" style={{ marginTop: espaco.md }}>
          {erro}
        </Texto>
      ) : null}

      <Botao
        titulo="Enviar denúncia"
        bloco
        carregando={enviando}
        onPress={() => void enviar()}
        style={{ marginTop: espaco.md }}
      />
    </FolhaInferior>
  );
}

const estilos = StyleSheet.create({
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingVertical: 14,
    minHeight: 44,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: raio.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
